import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyA_JfZNfuGsBJ6TOpH7mDZP9u9Tsrgnyt8",
  authDomain: "lensakita-studio.firebaseapp.com",
  projectId: "lensakita-studio",
  storageBucket: "lensakita-studio.firebasestorage.app",
  messagingSenderId: "804201114610",
  appId: "1:804201114610:web:deade9df4890f4188fd96b"
};

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);
const auth = getAuth(fbApp);
const txCol = collection(db, "transaksi");

let cache = [];            // data dari Firestore (hanya terisi kalau admin login)
const localTx = new Map(); // pesanan yang dibuat pengunjung di browser ini
const qrExpiry = new Map();
let isAdmin = false;
let unsubscribe = null;
let qrTimer = null;
let currentInvoiceId = null;

const packages = [
  {id:"photo-event",name:"Foto Event",price:750000,desc:"Dokumentasi foto acara hingga 3 jam.",tag:"POPULER"},
  {id:"video-event",name:"Video Event",price:1200000,desc:"Video dokumentasi acara hingga 3 jam."},
  {id:"photo-video",name:"Foto + Video",price:1750000,desc:"Paket lengkap foto dan video acara.",tag:"HEMAT"},
  {id:"product",name:"Foto Produk",price:500000,desc:"Foto produk untuk katalog dan media sosial."}
];

const $ = id => document.getElementById(id);
const money = value => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(value);
const todayISO = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
function loadTransactions(){return cache}
function findTx(id){return cache.find(t=>t.id===id)||localTx.get(id)}
function invoiceNumber(){return "LK-"+new Date().getFullYear()+String(Date.now()).slice(-6)}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function showToast(message){$("toast").textContent=message;$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),2600)}

/* ================= AUTH ADMIN ================= */
function openLogin(){$("loginModal").classList.add("show");$("loginModal").setAttribute("aria-hidden","false");$("loginEmail").focus()}
function closeLogin(){$("loginModal").classList.remove("show");$("loginModal").setAttribute("aria-hidden","true");$("loginForm").reset()}
$("loginBtn").addEventListener("click",openLogin);
$("closeLogin").addEventListener("click",closeLogin);
$("loginModal").addEventListener("click",e=>{if(e.target===$("loginModal"))closeLogin()});
$("logoutBtn").addEventListener("click",async()=>{await signOut(auth);showToast("Anda telah logout.")});

$("loginForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const btn=$("loginSubmit");btn.disabled=true;btn.textContent="Memproses...";
  try{
    await signInWithEmailAndPassword(auth,$("loginEmail").value.trim(),$("loginPassword").value);
    closeLogin();showToast("Login berhasil. Selamat datang, Admin!");
    setTimeout(()=>{location.hash="#admin"},150);
  }catch(err){
    console.error(err);showToast("Login gagal. Cek email dan password.");
  }finally{btn.disabled=false;btn.textContent="Masuk"}
});

onAuthStateChanged(auth,user=>{
  isAdmin=!!user;
  $("admin").hidden=!isAdmin;
  $("navAdmin").hidden=!isAdmin;
  $("loginBtn").hidden=isAdmin;
  $("logoutBtn").hidden=!isAdmin;
  if(unsubscribe){unsubscribe();unsubscribe=null}
  if(isAdmin){
    // realtime hanya aktif untuk admin
    unsubscribe=onSnapshot(txCol,snap=>{
      cache=snap.docs.map(d=>d.data()).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
      renderDashboard();
      if($("invoiceModal").classList.contains("show")&&currentInvoiceId){
        const tx=findTx(currentInvoiceId);if(tx)renderInvoice(tx);
      }
    },err=>{console.error(err);showToast("Gagal membaca database. Cek Rules Firestore.")});
  }else{
    cache=[];renderDashboard();
    if(location.hash==="#admin")location.hash="#beranda";
  }
});

/* ================= PAKET & PEMESANAN ================= */
function renderPackages(){
  $("packageGrid").innerHTML=packages.map((p,i)=>`<article class="package-card ${i===2?"featured":""}">${p.tag?`<span class="package-tag">${p.tag}</span>`:""}<span class="package-number">0${i+1}</span><h3>${p.name}</h3><p>${p.desc}</p><div class="package-price">${money(p.price)} <small>/ paket</small></div></article>`).join("");
  $("packageSelect").innerHTML='<option value="">Pilih paket layanan</option>'+packages.map(p=>`<option value="${p.id}">${p.name} — ${money(p.price)}</option>`).join("");
}
function selectedPackage(){return packages.find(p=>p.id===$("packageSelect").value)}
$("packageSelect").addEventListener("change",()=>{$("bookingPrice").textContent=money(selectedPackage()?.price||0)});
$("serviceDate").min=todayISO();
$("bookingForm").addEventListener("submit",e=>{
  e.preventDefault();
  const pkg=selectedPackage();if(!pkg){showToast("Pilih paket terlebih dahulu.");return}
  const tx={id:invoiceNumber(),name:$("customerName").value.trim(),contact:$("customerContact").value.trim(),packageId:pkg.id,packageName:pkg.name,price:pkg.price,date:$("serviceDate").value,notes:$("notes").value.trim(),createdAt:new Date().toISOString(),status:"Belum dibayar",method:"-",paidAt:null};
  localTx.set(tx.id,tx);
  setDoc(doc(db,"transaksi",tx.id),tx).catch(err=>{console.error(err);showToast("Gagal menyimpan ke database.")});
  openInvoice(tx.id,tx);$("bookingForm").reset();$("bookingPrice").textContent=money(0);showToast("Pesanan berhasil dibuat. Invoice siap dilihat.");
});

/* ================= INVOICE ================= */
function openInvoice(id,txGiven){const tx=txGiven||findTx(id);if(!tx)return;currentInvoiceId=id;renderInvoice(tx);$("invoiceModal").classList.add("show");$("invoiceModal").setAttribute("aria-hidden","false")}
function closeInvoice(){clearInterval(qrTimer);$("invoiceModal").classList.remove("show");$("invoiceModal").setAttribute("aria-hidden","true")}
$("closeInvoice").addEventListener("click",closeInvoice);
$("invoiceModal").addEventListener("click",e=>{if(e.target===$("invoiceModal"))closeInvoice()});
$("printInvoice").addEventListener("click",()=>window.print());

// QR simulasi (bukan QRIS asli): pola dibuat dari nomor invoice
function fakeQrSvg(seed){
  const N=25,cell=8;let h=2166136261;
  for(const c of seed){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}
  const rand=()=>{h^=h<<13;h^=h>>>17;h^=h<<5;return (h>>>0)/4294967296};
  const inFinder=(r,c)=>[[0,0],[0,N-7],[N-7,0]].some(([fr,fc])=>r>=fr-1&&r<=fr+7&&c>=fc-1&&c<=fc+7);
  let rects="";
  for(let r=0;r<N;r++)for(let c=0;c<N;c++){
    if(inFinder(r,c))continue;
    if(rand()>0.52)rects+=`<rect x="${c*cell}" y="${r*cell}" width="${cell}" height="${cell}"/>`;
  }
  const finder=(fr,fc)=>`<rect x="${fc*cell}" y="${fr*cell}" width="${7*cell}" height="${7*cell}"/><rect x="${(fc+1)*cell}" y="${(fr+1)*cell}" width="${5*cell}" height="${5*cell}" fill="#fff"/><rect x="${(fc+2)*cell}" y="${(fr+2)*cell}" width="${3*cell}" height="${3*cell}"/>`;
  return `<svg viewBox="0 0 ${N*cell} ${N*cell}" xmlns="http://www.w3.org/2000/svg" fill="#111" role="img" aria-label="QR simulasi"><rect width="100%" height="100%" fill="#fff"/>${rects}${finder(0,0)}${finder(0,N-7)}${finder(N-7,0)}</svg>`;
}
function fmtCountdown(ms){const s=Math.max(0,Math.floor(ms/1000));return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0")}

function renderInvoice(tx){
  clearInterval(qrTimer);
  const date=new Date(tx.createdAt).toLocaleDateString("id-ID",{day:"2-digit",month:"long",year:"numeric"});
  const serviceDate=new Date(tx.date+"T00:00:00").toLocaleDateString("id-ID",{day:"2-digit",month:"long",year:"numeric"});
  const paid=tx.status==="Lunas";
  if(!paid&&!qrExpiry.has(tx.id))qrExpiry.set(tx.id,Date.now()+15*60*1000);
  $("invoiceContent").innerHTML=`
    <div class="invoice-head"><div><span class="invoice-label">INVOICE / ${escapeHtml(tx.id)}</span><h2>LensaKita Studio</h2><p>Jasa Fotografi & Videografi<br>Dokumentasi momen berharga Anda.</p></div><div>${paid?'<span class="paid-stamp">LUNAS</span>':'<span class="invoice-label">MENUNGGU PEMBAYARAN</span>'}<p>Tanggal invoice: ${date}<br>Tanggal layanan: ${serviceDate}</p></div></div>
    <div class="invoice-meta"><div><h4>Ditagihkan kepada</h4><strong>${escapeHtml(tx.name)}</strong><p>${escapeHtml(tx.contact)}</p></div><div><h4>Detail pesanan</h4><strong>${escapeHtml(tx.packageName)}</strong><p>${escapeHtml(tx.notes||"Tidak ada catatan tambahan.")}</p></div></div>
    <table><thead><tr><th>Deskripsi</th><th>Jumlah</th><th>Harga</th></tr></thead><tbody><tr><td>${escapeHtml(tx.packageName)}</td><td>1 paket</td><td>${money(tx.price)}</td></tr></tbody></table>
    <div class="invoice-total"><span>Total pembayaran</span><strong>${money(tx.price)}</strong></div>
    <p class="invoice-note">Status: <strong>${escapeHtml(tx.status)}</strong>${paid?`<br>Metode: ${escapeHtml(tx.method)}<br>Waktu pembayaran: ${new Date(tx.paidAt).toLocaleString("id-ID")}`:""}<br><br>Terima kasih telah memilih LensaKita Studio. Simpan invoice ini sebagai bukti pemesanan. Untuk versi tugas ini, pembayaran merupakan simulasi dan bukan transaksi uang sungguhan.</p>
    ${paid?"":`<div class="payment-box">
      <h3>Pembayaran (simulasi)</h3>
      <div class="payment-controls">
        <select id="paymentMethod">
          <option value="QRIS">QRIS (simulasi)</option>
          <option value="Transfer Internal">Transfer Internal (simulasi)</option>
          <option value="Tunai">Tunai</option>
        </select>
      </div>
      <div class="qris-box" id="qrisBox">
        <div class="qris-head"><strong>QRIS</strong><span>LENSAKITA STUDIO</span></div>
        <div class="qris-code">${fakeQrSvg(tx.id)}</div>
        <div class="qris-amount">${money(tx.price)}</div>
        <p class="qris-timer">Berlaku <strong id="qrisTimer">15:00</strong> <button type="button" class="link-btn" id="refreshQr">Perbarui QR</button></p>
        <p class="invoice-note">Ini QR simulasi untuk tugas, tidak bisa dibayar lewat aplikasi bank/e-wallet asli. Klik tombol di bawah untuk mensimulasikan pelanggan sudah scan & bayar.</p>
      </div>
      <button class="btn primary" id="confirmPayment">Simulasikan Scan & Bayar</button>
    </div>`}
  `;
  if(paid)return;
  const select=$("paymentMethod"),qrisBox=$("qrisBox"),btn=$("confirmPayment");
  const sync=()=>{
    const isQris=select.value==="QRIS";
    qrisBox.hidden=!isQris;
    btn.textContent=isQris?"Simulasikan Scan & Bayar":"Konfirmasi Pembayaran";
  };
  select.addEventListener("change",sync);sync();
  btn.addEventListener("click",()=>payInvoice(tx.id));
  const tick=()=>{
    const left=qrExpiry.get(tx.id)-Date.now(),t=$("qrisTimer");if(!t)return;
    if(left<=0){t.textContent="KEDALUWARSA";if(select.value==="QRIS")btn.disabled=true;return}
    t.textContent=fmtCountdown(left);
  };
  $("refreshQr").addEventListener("click",()=>{qrExpiry.set(tx.id,Date.now()+15*60*1000);btn.disabled=false;tick();showToast("QR diperbarui.")});
  tick();qrTimer=setInterval(tick,1000);
}

async function payInvoice(id){
  const select=$("paymentMethod");
  const method=select?.value==="QRIS"?"QRIS (simulasi)":(select?.value||"Transfer Internal");
  const tx=findTx(id);if(!tx)return;
  const btn=$("confirmPayment");
  if(select?.value==="QRIS"){
    btn.disabled=true;btn.textContent="Memverifikasi pembayaran...";
    await new Promise(r=>setTimeout(r,1500));
  }
  const upd={status:"Lunas",method,paidAt:new Date().toISOString()};
  updateDoc(doc(db,"transaksi",id),upd).catch(err=>{console.error(err);showToast("Gagal menyimpan pembayaran.")});
  const updated={...tx,...upd};
  localTx.set(id,updated);
  renderInvoice(updated);showToast("Pembayaran berhasil (simulasi). Invoice berstatus Lunas.");
}

/* ================= DASHBOARD (ADMIN) ================= */
function filteredTransactions(){
  const data=loadTransactions(),filter=$("reportFilter").value,now=new Date();
  return data.filter(t=>{const d=new Date(t.createdAt);if(filter==="week"){const start=new Date(now);start.setDate(now.getDate()-6);start.setHours(0,0,0,0);return d>=start&&d<=now}if(filter==="month")return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();return true});
}
function renderDashboard(){
  const data=filteredTransactions();const paid=data.filter(t=>t.status==="Lunas").reduce((s,t)=>s+t.price,0);const unpaid=data.filter(t=>t.status!=="Lunas").reduce((s,t)=>s+t.price,0);
  $("totalTransactions").textContent=data.length;$("totalRevenue").textContent=money(paid);$("unpaidTotal").textContent=money(unpaid);
  const f=$("reportFilter").value;$("reportRange").textContent=f==="week"?"7 hari terakhir":f==="month"?"Bulan ini":"Semua periode";
  $("transactionRows").innerHTML=data.length?data.map(t=>`<tr><td>${escapeHtml(t.id)}</td><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.packageName)}</td><td>${new Date(t.date+"T00:00:00").toLocaleDateString("id-ID")}</td><td>${money(t.price)}</td><td><span class="status ${t.status==="Lunas"?"paid":"unpaid"}">${escapeHtml(t.status)}</span></td><td><button class="table-action" data-invoice="${escapeHtml(t.id)}">Invoice</button></td></tr>`).join(""):'<tr><td colspan="7" class="empty">Tidak ada transaksi pada periode ini.</td></tr>';
  document.querySelectorAll("[data-invoice]").forEach(btn=>btn.addEventListener("click",()=>openInvoice(btn.dataset.invoice)));
}
$("reportFilter").addEventListener("change",renderDashboard);
$("exportCsv").addEventListener("click",()=>{
  if(!isAdmin)return;
  const rows=filteredTransactions();if(!rows.length){showToast("Belum ada data untuk diunduh.");return}
  const header=["Invoice","Nama","Kontak","Paket","Tanggal Layanan","Total","Status","Metode Pembayaran","Tanggal Transaksi"];
  const csv=[header,...rows.map(t=>[t.id,t.name,t.contact,t.packageName,t.date,t.price,t.status,t.method,t.createdAt])].map(row=>row.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\r\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="laporan-lensakita.csv";a.click();URL.revokeObjectURL(url);showToast("Laporan CSV berhasil diunduh.");
});
$("clearData").addEventListener("click",async()=>{
  if(!isAdmin)return;
  if(confirm("Yakin ingin menghapus SEMUA transaksi? Data terhapus permanen.")){
    for(const t of [...cache]) await deleteDoc(doc(db,"transaksi",t.id));
    closeInvoice();showToast("Data transaksi telah dihapus.");
  }
});

renderPackages();renderDashboard();

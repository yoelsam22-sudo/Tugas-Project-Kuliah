import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

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
const pubCol = collection(db, "pesanan_publik");
const ADMIN_EMAILS = ["adminlensa@gmail.com"]; // email admin, samakan dengan Firestore Rules

let cache = [];            // semua transaksi (khusus admin)
let myCache = [];          // transaksi milik user yang login
let publicCache = [];      // feed pesanan publik (nama disamarkan)
const localTx = new Map(); // pesanan yang baru dibuat di browser ini
const qrExpiry = new Map();
let isAdmin = false;
let currentUser = null;
let unsubscribe = null;
let unsubMine = null;
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
function findTx(id){return cache.find(t=>t.id===id)||myCache.find(t=>t.id===id)||localTx.get(id)}
function invoiceNumber(){return "LK-"+new Date().getFullYear()+String(Date.now()).slice(-6)}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function showToast(message){$("toast").textContent=message;$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),2600)}

/* ================= EFEK VISUAL ================= */
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const rnd = (a,b) => a + Math.random()*(b-a);

// confetti jatuh (dipakai saat pembayaran Lunas)
function confetti(x,y,count=40){
  if(reduceMotion)return;
  const colors=["#2d5a4a","#c9a14a","#e6cf94","#7fa896","#f3e7c3","#1c3a2f"];
  for(let i=0;i<count;i++){
    const el=document.createElement("span");
    el.className="confetti";
    const w=rnd(6,11),h=rnd(8,16);
    el.style.cssText=`left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${colors[i%colors.length]}`;
    document.body.appendChild(el);
    const dx=rnd(-220,220),up=rnd(80,200),down=rnd(220,420),rot=rnd(-540,540);
    const anim=el.animate([
      {transform:"translate(-50%,-50%) rotate(0deg)",opacity:1},
      {transform:`translate(calc(-50% + ${dx*.6}px),calc(-50% - ${up}px)) rotate(${rot*.5}deg)`,opacity:1,offset:.35},
      {transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${down}px)) rotate(${rot}deg)`,opacity:0}
    ],{duration:rnd(1200,1900),easing:"cubic-bezier(.25,.6,.4,1)"});
    anim.onfinish=()=>el.remove();
  }
}

// kartu paket diklik: pilih, atau batalkan kalau klik paket yang sama lagi
function onPackageClick(card,x,y){
  if(isAdmin)return; // admin tidak memesan
  const p=packages.find(pk=>pk.id===card.dataset.id);if(!p)return;

  if($("packageSelect").value===p.id){
    $("packageSelect").value="";
    $("bookingPrice").textContent=money(0);
    syncSelectedCard();
    showToast("Pilihan paket dibatalkan.");
    return;
  }

  $("packageSelect").value=p.id;
  $("bookingPrice").textContent=money(p.price);
  syncSelectedCard();
  showToast(`${p.name} dipilih. Lanjut isi form pemesanan ya!`);
}
function syncSelectedCard(){
  const v=$("packageSelect").value;
  document.querySelectorAll(".package-card").forEach(c=>c.classList.toggle("selected",!!v&&c.dataset.id===v));
}

function setupPackageEffects(){
  document.querySelectorAll(".package-card").forEach(card=>{
    card.addEventListener("mousemove",e=>{
      const r=card.getBoundingClientRect();
      const px=(e.clientX-r.left)/r.width,py=(e.clientY-r.top)/r.height;
      card.style.setProperty("--mx",(px*100)+"%");
      card.style.setProperty("--my",(py*100)+"%");
      if(reduceMotion)return;
      card.style.transform=`perspective(700px) rotateX(${(.5-py)*8}deg) rotateY(${(px-.5)*8}deg) translateY(-4px)`;
    });
    card.addEventListener("mouseleave",()=>{card.style.transform=""});
    card.addEventListener("click",e=>onPackageClick(card,e.clientX,e.clientY));
    card.addEventListener("keydown",e=>{
      if(e.key!=="Enter"&&e.key!==" ")return;
      e.preventDefault();
      const r=card.getBoundingClientRect();
      onPackageClick(card,r.left+r.width/2,r.top+r.height/2);
    });
  });
}

// elemen muncul halus saat di-scroll
function setupReveal(){
  if(reduceMotion||!("IntersectionObserver" in window))return;
  const targets=document.querySelectorAll(".section-heading,.package-card,.article-card,.manual-grid > div,.booking-layout > *,.summary-card");
  const io=new IntersectionObserver(entries=>{
    entries.forEach(en=>{
      if(!en.isIntersecting)return;
      const el=en.target;io.unobserve(el);
      el.classList.add("in");
      setTimeout(()=>el.classList.remove("reveal","in"),1300);
    });
  },{threshold:.12});
  targets.forEach(el=>{
    const idx=Array.from(el.parentElement.children).indexOf(el);
    el.classList.add("reveal");
    el.style.setProperty("--d",((idx%4)*0.09)+"s");
    io.observe(el);
  });
}

function setupHeroEffects(){
  const hero=document.querySelector(".hero"),art=document.querySelector(".hero-art");
  if(!hero||reduceMotion)return;
  // foto hero bergeser pelan mengikuti mouse
  hero.addEventListener("mousemove",e=>{
    const r=hero.getBoundingClientRect();
    const x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;
    art.style.transform=`translate3d(${x*-18}px,${y*-14}px,0)`;
  });
  hero.addEventListener("mouseleave",()=>{art.style.transform=""});
}

function setupGlobalEffects(){
  // progress bar scroll + bayangan navbar
  const bar=document.createElement("div");bar.id="scrollBar";document.body.appendChild(bar);
  const topbar=document.querySelector(".topbar");
  const onScroll=()=>{
    const h=document.documentElement,max=h.scrollHeight-h.clientHeight;
    bar.style.width=(max>0?(h.scrollTop/max)*100:0)+"%";
    topbar.classList.toggle("scrolled",h.scrollTop>10);
  };
  addEventListener("scroll",onScroll,{passive:true});onScroll();

  // cahaya lembut mengikuti kursor (hanya perangkat dengan mouse)
  if(window.matchMedia("(hover:hover)").matches&&!reduceMotion){
    const glow=document.createElement("div");glow.className="cursor-glow";document.body.appendChild(glow);
    addEventListener("mousemove",e=>{glow.style.transform=`translate(${e.clientX-150}px,${e.clientY-150}px)`;glow.style.opacity=1},{passive:true});
    document.addEventListener("mouseleave",()=>{glow.style.opacity=0});
  }
}

/* ================= TRANSISI SETELAH LOGIN (SEDERHANA) ================= */
let justLoggedIn=null; // "login" | "register", diisi saat user menekan tombol masuk/daftar
function showWelcome(){
  if(reduceMotion)return;
  const old=$("welcome");if(old)old.remove();
  const el=document.createElement("div");
  el.id="welcome";el.className="welcome";
  document.body.appendChild(el);
  // 1) layar memudar ke hijau tua sebentar
  requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add("play")));
  // 2) layar menghilang, halaman (admin / pesan) muncul halus dari bawah
  setTimeout(()=>{
    el.classList.add("leave");
    document.body.classList.add("page-enter");
    setTimeout(()=>document.body.classList.remove("page-enter"),900);
  },450);
  setTimeout(()=>el.remove(),1300);
}

/* ================= AUTH (ADMIN & USER) ================= */
const authErrors={
  "auth/email-already-in-use":"Email sudah terdaftar. Klik Masuk.",
  "auth/weak-password":"Password minimal 6 karakter.",
  "auth/invalid-email":"Format email tidak valid.",
  "auth/user-not-found":"Akun belum terdaftar. Klik Daftar Akun Baru.",
  "auth/invalid-credential":"Email atau password salah, atau akun belum terdaftar.",
  "auth/operation-not-allowed":"Email/Password belum diaktifkan di Firebase.",
  "auth/admin-restricted-operation":"Pendaftaran akun baru dimatikan di Firebase.",
  "auth/unauthorized-domain":"Domain website ini belum diizinkan di Firebase.",
  "auth/network-request-failed":"Koneksi gagal. Buka lewat Live Server/localhost."
};
function authMessage(err,fallback){return (authErrors[err.code]||fallback)+" ["+err.code+"]"}
function openLogin(){$("loginModal").classList.add("show");$("loginModal").setAttribute("aria-hidden","false");$("loginEmail").focus()}
function closeLogin(){$("loginModal").classList.remove("show");$("loginModal").setAttribute("aria-hidden","true");$("loginForm").reset()}
$("loginBtn").addEventListener("click",openLogin);
$("closeLogin").addEventListener("click",closeLogin);
$("loginModal").addEventListener("click",e=>{if(e.target===$("loginModal"))closeLogin()});
$("logoutBtn").addEventListener("click",async()=>{await signOut(auth);showToast("Anda telah logout.")});

// MASUK (akun yang sudah ada)
$("loginForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const btn=$("loginSubmit");btn.disabled=true;btn.textContent="Memproses...";
  const email=$("loginEmail").value.trim(),pass=$("loginPassword").value;
  try{
    justLoggedIn="login";
    await signInWithEmailAndPassword(auth,email,pass);
    const goAdmin=ADMIN_EMAILS.includes(email.toLowerCase());
    closeLogin();showToast("Login berhasil. Selamat datang!");
    setTimeout(()=>{location.hash=goAdmin?"#admin":"#pesan"},150);
  }catch(err){
    justLoggedIn=null;console.error(err);showToast(authMessage(err,"Login gagal."));
  }finally{btn.disabled=false;btn.textContent="Masuk"}
});

// DAFTAR (akun baru)
$("registerBtn").addEventListener("click",async()=>{
  const email=$("loginEmail").value.trim(),pass=$("loginPassword").value;
  if(!email||pass.length<6){showToast("Isi email dan password (minimal 6 karakter).");return}
  const btn=$("registerBtn");btn.disabled=true;btn.textContent="Mendaftar...";
  try{
    justLoggedIn="register";
    await createUserWithEmailAndPassword(auth,email,pass);
    closeLogin();showToast("Akun berhasil dibuat. Selamat datang!");
    setTimeout(()=>{location.hash="#pesan"},150);
  }catch(err){
    justLoggedIn=null;console.error(err);showToast(authMessage(err,"Pendaftaran gagal."));
  }finally{btn.disabled=false;btn.textContent="Daftar Akun Baru"}
});

onAuthStateChanged(auth,user=>{
  currentUser=user;
  if(user&&justLoggedIn){const mode=justLoggedIn;justLoggedIn=null;showWelcome()}
  isAdmin=!!user&&ADMIN_EMAILS.includes((user.email||"").toLowerCase());
  const isUser=!!user&&!isAdmin;
  document.body.classList.toggle("is-admin",isAdmin);
  $("admin").hidden=!isAdmin;      $("navAdmin").hidden=!isAdmin;
  $("pesananku").hidden=!isUser;   $("navMine").hidden=!isUser;
  $("loginBtn").hidden=!!user;     $("logoutBtn").hidden=!user;
  $("userEmail").hidden=!user;     $("userEmail").textContent=user?user.email:"";
  if(unsubscribe){unsubscribe();unsubscribe=null}
  if(unsubMine){unsubMine();unsubMine=null}
  cache=[];myCache=[];

  const refreshOpenInvoice=()=>{
    if($("invoiceModal").classList.contains("show")&&currentInvoiceId){
      const tx=findTx(currentInvoiceId);if(tx)renderInvoice(tx);
    }
  };
  if(isAdmin){
    // realtime semua transaksi, hanya untuk admin
    unsubscribe=onSnapshot(txCol,snap=>{
      cache=snap.docs.map(d=>d.data()).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
      renderDashboard();refreshOpenInvoice();
    },err=>{console.error(err);showToast("Gagal membaca database. Cek Rules Firestore.")});
  }else if(isUser){
    // realtime hanya pesanan milik user ini
    if(!$("customerContact").value)$("customerContact").value=user.email;
    unsubMine=onSnapshot(query(txCol,where("uid","==",user.uid)),snap=>{
      myCache=snap.docs.map(d=>d.data()).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
      renderMine();refreshOpenInvoice();
    },err=>{console.error(err);showToast("Gagal membaca pesanan. Cek Rules Firestore.")});
  }
  renderDashboard();renderMine();
  if(!isAdmin&&location.hash==="#admin")location.hash="#beranda";
  if(!isUser&&location.hash==="#pesananku")location.hash="#beranda";
});

/* ================= FEED PUBLIK & PESANAN SAYA ================= */
function maskName(name){
  const p=String(name||"").trim().split(/\s+/).filter(Boolean);
  if(!p.length)return "Pelanggan";
  if(p.length===1)return p[0].slice(0,3)+"***";
  return p[0]+" "+p[p.length-1][0].toUpperCase()+".";
}
function renderPublicFeed(){
  $("publicFeed").innerHTML=publicCache.length?publicCache.slice(0,9).map(p=>`<div class="feed-item"><div class="feed-avatar">${escapeHtml((p.maskedName||"?")[0].toUpperCase())}</div><div class="feed-info"><strong>${escapeHtml(p.maskedName)}</strong><span>${escapeHtml(p.packageName)} · ${new Date(p.date+"T00:00:00").toLocaleDateString("id-ID",{day:"2-digit",month:"short",year:"numeric"})}</span></div><span class="status ${p.status==="Lunas"?"paid":"unpaid"}">${escapeHtml(p.status)}</span></div>`).join(""):'<p class="empty">Belum ada pesanan. Jadilah yang pertama!</p>';
}
function renderMine(){
  $("myRows").innerHTML=myCache.length?myCache.map(t=>`<tr><td>${escapeHtml(t.id)}</td><td>${escapeHtml(t.packageName)}</td><td>${new Date(t.date+"T00:00:00").toLocaleDateString("id-ID")}</td><td>${money(t.price)}</td><td><span class="status ${t.status==="Lunas"?"paid":"unpaid"}">${escapeHtml(t.status)}</span></td><td><button class="table-action" data-my="${escapeHtml(t.id)}">Invoice</button></td></tr>`).join(""):'<tr><td colspan="6" class="empty">Belum ada pesanan.</td></tr>';
  document.querySelectorAll("[data-my]").forEach(b=>b.addEventListener("click",()=>openInvoice(b.dataset.my)));
}
function historyHtml(tx){
  const h=(tx.history&&tx.history.length)?tx.history:[{time:tx.createdAt,action:"Pesanan dibuat",method:"-",ref:"-",status:"Belum dibayar"}].concat(tx.status==="Lunas"?[{time:tx.paidAt,action:"Pembayaran diterima",method:tx.method,ref:"-",status:"Lunas"}]:[]);
  return `<h4 class="history-title">Riwayat pembayaran</h4><table class="history-table"><thead><tr><th>Waktu</th><th>Aktivitas</th><th>Metode</th><th>Ref</th><th>Status</th></tr></thead><tbody>${h.map(x=>`<tr><td>${new Date(x.time).toLocaleString("id-ID")}</td><td>${escapeHtml(x.action)}</td><td>${escapeHtml(x.method||"-")}</td><td>${escapeHtml(x.ref||"-")}</td><td>${escapeHtml(x.status)}</td></tr>`).join("")}</tbody></table>`;
}

/* ================= PAKET & PEMESANAN ================= */
function renderPackages(){
  $("packageGrid").innerHTML=packages.map((p,i)=>`<article class="package-card ${i===2?"featured":""}" data-id="${p.id}" tabindex="0" role="button" aria-label="Pilih paket ${p.name}">${p.tag?`<span class="package-tag">${p.tag}</span>`:""}<span class="package-number">0${i+1}</span><h3>${p.name}</h3><p>${p.desc}</p><div class="package-price">${money(p.price)} <small>/ paket</small></div></article>`).join("");
  $("packageSelect").innerHTML='<option value="">Pilih paket layanan</option>'+packages.map(p=>`<option value="${p.id}">${p.name} — ${money(p.price)}</option>`).join("");
}
function selectedPackage(){return packages.find(p=>p.id===$("packageSelect").value)}
$("packageSelect").addEventListener("change",()=>{$("bookingPrice").textContent=money(selectedPackage()?.price||0);syncSelectedCard()});
$("serviceDate").min=todayISO();
$("bookingForm").addEventListener("submit",e=>{
  e.preventDefault();
  if(isAdmin){showToast("Admin tidak dapat membuat pesanan.");return}
  if(!currentUser){showToast("Masuk atau daftar dulu untuk memesan.");openLogin("login");return}
  const pkg=selectedPackage();if(!pkg){showToast("Pilih paket terlebih dahulu.");return}
  const now=new Date().toISOString();
  const tx={id:invoiceNumber(),uid:currentUser.uid,email:currentUser.email,name:$("customerName").value.trim(),contact:$("customerContact").value.trim(),packageId:pkg.id,packageName:pkg.name,price:pkg.price,date:$("serviceDate").value,notes:$("notes").value.trim(),createdAt:now,status:"Belum dibayar",method:"-",paidAt:null,
    history:[{time:now,action:"Pesanan dibuat",method:"-",ref:"-",status:"Belum dibayar"}]};
  localTx.set(tx.id,tx);
  setDoc(doc(db,"transaksi",tx.id),tx).catch(err=>{console.error(err);showToast("Gagal menyimpan ke database.")});
  // feed publik: hanya nama disamarkan, paket, tanggal, status (tanpa kontak & harga)
  setDoc(doc(db,"pesanan_publik",tx.id),{id:tx.id,maskedName:maskName(tx.name),packageName:tx.packageName,date:tx.date,createdAt:now,status:tx.status}).catch(console.error);
  openInvoice(tx.id,tx);$("bookingForm").reset();$("customerContact").value=currentUser.email;$("bookingPrice").textContent=money(0);syncSelectedCard();showToast("Pesanan berhasil dibuat. Invoice siap dilihat.");
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
    ${historyHtml(tx)}
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
  const now=new Date().toISOString();
  const ref="PAY-"+Math.random().toString(36).slice(2,8).toUpperCase();
  const base=(tx.history&&tx.history.length)?tx.history:[{time:tx.createdAt,action:"Pesanan dibuat",method:"-",ref:"-",status:"Belum dibayar"}];
  const upd={status:"Lunas",method,paidAt:now,payRef:ref,history:[...base,{time:now,action:"Pembayaran diterima",method,ref,status:"Lunas"}]};
  updateDoc(doc(db,"transaksi",id),upd).catch(err=>{console.error(err);showToast("Gagal menyimpan pembayaran.")});
  updateDoc(doc(db,"pesanan_publik",id),{status:"Lunas"}).catch(console.error);
  const updated={...tx,...upd};
  localTx.set(id,updated);
  renderInvoice(updated);showToast("Pembayaran berhasil (simulasi). Invoice berstatus Lunas.");
  // perayaan: confetti
  confetti(window.innerWidth/2,window.innerHeight*0.35);
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
    for(const t of [...cache]){
      await deleteDoc(doc(db,"transaksi",t.id));
      await deleteDoc(doc(db,"pesanan_publik",t.id)).catch(()=>{});
    }
    closeInvoice();showToast("Data transaksi telah dihapus.");
  }
});

/* ================= INISIALISASI ================= */
renderPackages();
renderDashboard();
renderMine();
// feed publik: realtime, bisa dilihat semua pengunjung
onSnapshot(pubCol,snap=>{
  publicCache=snap.docs.map(d=>d.data()).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  renderPublicFeed();
},err=>console.error(err));
renderPublicFeed();
setupPackageEffects();
setupReveal();
setupHeroEffects();
setupGlobalEffects();

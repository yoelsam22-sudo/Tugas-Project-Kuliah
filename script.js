const packages = [
  {id:"photo-event",name:"Foto Event",price:750000,desc:"Dokumentasi foto acara hingga 3 jam.",tag:"POPULER"},
  {id:"video-event",name:"Video Event",price:1200000,desc:"Video dokumentasi acara hingga 3 jam."},
  {id:"photo-video",name:"Foto + Video",price:1750000,desc:"Paket lengkap foto dan video acara.",tag:"HEMAT"},
  {id:"product",name:"Foto Produk",price:500000,desc:"Foto produk untuk katalog dan media sosial."}
];
const $ = id => document.getElementById(id);
const money = value => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(value);
const todayISO = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
let currentInvoiceId = null;
const storageKey = "lensakita_transactions_v1";
function loadTransactions(){try{return JSON.parse(localStorage.getItem(storageKey)||"[]")}catch{return []}}
function saveTransactions(data){localStorage.setItem(storageKey,JSON.stringify(data))}
function invoiceNumber(){return "LK-"+new Date().getFullYear()+String(Date.now()).slice(-6)}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function showToast(message){$("toast").textContent=message;$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),2600)}
function renderPackages(){
  $("packageGrid").innerHTML=packages.map((p,i)=>`<article class="package-card ${i===2?"featured":""}">${p.tag?`<span class="package-tag">${p.tag}</span>`:""}<span class="package-number">0${i+1}</span><h3>${p.name}</h3><p>${p.desc}</p><div class="package-price">${money(p.price)} <small>/ paket</small></div></article>`).join("");
  $("packageSelect").innerHTML='<option value="">Pilih paket layanan</option>'+packages.map(p=>`<option value="${p.id}">${p.name} — ${money(p.price)}</option>`).join("");
}
function selectedPackage(){return packages.find(p=>p.id===$("packageSelect").value)}
$("packageSelect").addEventListener("change",()=>{$("bookingPrice").textContent=money(selectedPackage()?.price||0)});
$("serviceDate").min=todayISO();
$("bookingForm").addEventListener("submit",e=>{
  e.preventDefault();
  const pkg=selectedPackage(); if(!pkg){showToast("Pilih paket terlebih dahulu.");return}
  const tx={id:invoiceNumber(),name:$("customerName").value.trim(),contact:$("customerContact").value.trim(),packageId:pkg.id,packageName:pkg.name,price:pkg.price,date:$("serviceDate").value,notes:$("notes").value.trim(),createdAt:new Date().toISOString(),status:"Belum dibayar",method:"-",paidAt:null};
  const transactions=loadTransactions();transactions.unshift(tx);saveTransactions(transactions);
  currentInvoiceId=tx.id;renderDashboard();openInvoice(tx.id);$("bookingForm").reset();$("bookingPrice").textContent=money(0);showToast("Pesanan berhasil dibuat. Invoice siap dilihat.");
});
function openInvoice(id){const tx=loadTransactions().find(t=>t.id===id);if(!tx)return;currentInvoiceId=id;renderInvoice(tx);$("invoiceModal").classList.add("show");$("invoiceModal").setAttribute("aria-hidden","false")}
function closeInvoice(){$("invoiceModal").classList.remove("show");$("invoiceModal").setAttribute("aria-hidden","true")}
$("closeInvoice").addEventListener("click",closeInvoice);
$("invoiceModal").addEventListener("click",e=>{if(e.target===$("invoiceModal"))closeInvoice()});
$("printInvoice").addEventListener("click",()=>window.print());
function renderInvoice(tx){
  const date=new Date(tx.createdAt).toLocaleDateString("id-ID",{day:"2-digit",month:"long",year:"numeric"});
  const serviceDate=new Date(tx.date+"T00:00:00").toLocaleDateString("id-ID",{day:"2-digit",month:"long",year:"numeric"});
  const paid=tx.status==="Lunas";
  $("invoiceContent").innerHTML=`
    <div class="invoice-head"><div><span class="invoice-label">INVOICE / ${escapeHtml(tx.id)}</span><h2>LensaKita Studio</h2><p>Jasa Fotografi & Videografi<br>Dokumentasi momen berharga Anda.</p></div><div>${paid?'<span class="paid-stamp">LUNAS</span>':'<span class="invoice-label">MENUNGGU PEMBAYARAN</span>'}<p>Tanggal invoice: ${date}<br>Tanggal layanan: ${serviceDate}</p></div></div>
    <div class="invoice-meta"><div><h4>Ditagihkan kepada</h4><strong>${escapeHtml(tx.name)}</strong><p>${escapeHtml(tx.contact)}</p></div><div><h4>Detail pesanan</h4><strong>${escapeHtml(tx.packageName)}</strong><p>${escapeHtml(tx.notes||"Tidak ada catatan tambahan.")}</p></div></div>
    <table><thead><tr><th>Deskripsi</th><th>Jumlah</th><th>Harga</th></tr></thead><tbody><tr><td>${escapeHtml(tx.packageName)}</td><td>1 paket</td><td>${money(tx.price)}</td></tr></tbody></table>
    <div class="invoice-total"><span>Total pembayaran</span><strong>${money(tx.price)}</strong></div>
    <p class="invoice-note">Status: <strong>${escapeHtml(tx.status)}</strong>${paid?`<br>Metode: ${escapeHtml(tx.method)}<br>Waktu pembayaran: ${new Date(tx.paidAt).toLocaleString("id-ID")}`:""}<br><br>Terima kasih telah memilih LensaKita Studio. Simpan invoice ini sebagai bukti pemesanan. Untuk versi tugas ini, pembayaran merupakan simulasi internal dan bukan transaksi uang sungguhan.</p>
    ${paid?"":`<div class="payment-box"><h3>Pembayaran internal (simulasi)</h3><p class="invoice-note">Pilih metode lalu konfirmasi. Sistem akan mengubah status invoice menjadi Lunas tanpa menghubungi bank atau payment gateway eksternal.</p><div class="payment-controls"><select id="paymentMethod"><option value="Transfer Internal">Transfer Internal (simulasi)</option><option value="Tunai">Tunai</option><option value="QR Internal">QR Internal (simulasi)</option></select><button class="btn primary" id="confirmPayment">Konfirmasi Pembayaran</button></div></div>`}
  `;
  const confirm=$("confirmPayment");if(confirm)confirm.addEventListener("click",()=>payInvoice(tx.id));
}
function payInvoice(id){
  const method=$("paymentMethod")?.value||"Transfer Internal";
  const data=loadTransactions();const tx=data.find(t=>t.id===id);if(!tx)return;
  tx.status="Lunas";tx.method=method;tx.paidAt=new Date().toISOString();saveTransactions(data);
  renderDashboard();renderInvoice(tx);showToast("Pembayaran simulasi berhasil. Invoice berstatus Lunas.");
}
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
  const rows=filteredTransactions();if(!rows.length){showToast("Belum ada data untuk diunduh.");return}
  const header=["Invoice","Nama","Kontak","Paket","Tanggal Layanan","Total","Status","Metode Pembayaran","Tanggal Transaksi"];
  const csv=[header,...rows.map(t=>[t.id,t.name,t.contact,t.packageName,t.date,t.price,t.status,t.method,t.createdAt])].map(row=>row.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\r\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="laporan-lensakita.csv";a.click();URL.revokeObjectURL(url);showToast("Laporan CSV berhasil diunduh.");
});
$("clearData").addEventListener("click",()=>{if(confirm("Yakin ingin menghapus semua transaksi demo di browser ini?")){localStorage.removeItem(storageKey);renderDashboard();closeInvoice();showToast("Data demo telah dihapus.")}});
renderPackages();renderDashboard();

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
const PHOTOGRAPHER_EMAILS = ["fotografer@gmail.com"]; // email akun fotografer (daftar dulu lewat "Daftar Akun Baru"), samakan dengan Firestore Rules
const MAX_PER_DAY = 5; // maksimal pelanggan aktif per tanggal layanan

let cache = [];            // semua transaksi (khusus admin)
let myCache = [];          // transaksi milik user yang login
let publicCache = [];      // feed pesanan publik (nama disamarkan)
const localTx = new Map(); // pesanan yang baru dibuat di browser ini
const qrExpiry = new Map();
let isAdmin = false;
let isPhotog = false;
let notifPrev = new Map();
let firstMine = true;
let currentUser = null;
let unsubscribe = null;
let unsubMine = null;
let qrTimer = null;
let payTimer = null;
let currentInvoiceId = null;

const packages = [
  {id:"photo-event",name:"Foto Event",price:750000,img:"paket-foto-event.jpg",desc:"Dokumentasi foto acara hingga 3 jam.",tag:"POPULER"},
  {id:"video-event",name:"Video Event",price:1200000,img:"paket-video-event.jpg",desc:"Video dokumentasi acara hingga 3 jam."},
  {id:"photo-video",name:"Foto + Video",price:1750000,img:"paket-foto-video.jpg",desc:"Paket lengkap foto dan video acara.",tag:"HEMAT"},
  {id:"product",name:"Foto Produk",price:500000,img:"paket-foto-produk.jpg",desc:"Foto produk untuk katalog dan media sosial."}
];

const $ = id => document.getElementById(id);
const money = value => new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(value);
const todayISO = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
function loadTransactions(){return cache}
function findTx(id){return cache.find(t=>t.id===id)||myCache.find(t=>t.id===id)||localTx.get(id)}
function invoiceNumber(){return "LK-"+new Date().getFullYear()+String(Date.now()).slice(-6)}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function showToast(message){$("toast").textContent=message;$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),2600)}

/* ================= HELPER PERAN & STATUS ================= */
const emailIn=(list,e)=>list.includes(String(e||"").toLowerCase());
const roleHash=e=>emailIn(ADMIN_EMAILS,e)?"#admin":emailIn(PHOTOGRAPHER_EMAILS,e)?"#fotografer":"#pesan";
const apr=t=>t.approval||"Disetujui"; // pesanan lama tanpa status dianggap disetujui
const isActive=a=>a==="Menunggu"||a==="Disetujui";
const dFmt=(d,o={day:"2-digit",month:"long",year:"numeric"})=>new Date(d+"T00:00:00").toLocaleDateString("id-ID",o);

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
  if(isAdmin||isPhotog)return; // admin/fotografer tidak memesan
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
    const target=roleHash(email);
    closeLogin();showToast("Login berhasil. Selamat datang!");
    setTimeout(()=>{location.hash=target},150);
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
  if(user&&justLoggedIn){justLoggedIn=null;showWelcome()}
  isAdmin=!!user&&emailIn(ADMIN_EMAILS,user.email);
  isPhotog=!!user&&!isAdmin&&emailIn(PHOTOGRAPHER_EMAILS,user.email);
  const isUser=!!user&&!isAdmin&&!isPhotog;
  document.body.classList.toggle("is-admin",isAdmin||isPhotog);
  document.body.classList.toggle("is-photog",isPhotog);
  $("admin").hidden=!isAdmin;       $("navAdmin").hidden=!isAdmin;
  $("fotografer").hidden=!isPhotog; $("navPhotog").hidden=!isPhotog;
  $("pesananku").hidden=!isUser;    $("navMine").hidden=!isUser;
  $("notifBtn").hidden=!isUser;
  $("loginBtn").hidden=!!user;      $("logoutBtn").hidden=!user;
  $("userEmail").hidden=!user;      $("userEmail").textContent=user?user.email:"";
  if(unsubscribe){unsubscribe();unsubscribe=null}
  if(unsubMine){unsubMine();unsubMine=null}
  cache=[];myCache=[];notifPrev=new Map();firstMine=true;

  const refreshOpenInvoice=()=>{
    if($("invoiceModal").classList.contains("show")&&currentInvoiceId){
      const tx=findTx(currentInvoiceId);if(tx)renderInvoice(tx);
    }
  };
  if(isAdmin||isPhotog){
    // realtime semua transaksi: admin (laporan) dan fotografer (jadwal & persetujuan)
    unsubscribe=onSnapshot(txCol,snap=>{
      cache=snap.docs.map(d=>d.data()).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
      renderDashboard();renderPhotog();refreshOpenInvoice();
    },err=>{console.error(err);showToast("Gagal membaca database. Cek Rules Firestore.")});
  }else if(isUser){
    // realtime hanya pesanan milik user ini
    if(!$("customerContact").value)$("customerContact").value=user.email;
    unsubMine=onSnapshot(query(txCol,where("uid","==",user.uid)),snap=>{
      myCache=snap.docs.map(d=>d.data()).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
      notifyChanges();renderMine();renderNotif();refreshOpenInvoice();
    },err=>{console.error(err);showToast("Gagal membaca pesanan. Cek Rules Firestore.")});
  }
  renderDashboard();renderPhotog();renderMine();renderNotif();
  if(!isAdmin&&location.hash==="#admin")location.hash="#beranda";
  if(!isPhotog&&location.hash==="#fotografer")location.hash="#beranda";
  if(!isUser&&location.hash==="#pesananku")location.hash="#beranda";
});

/* ================= FEED PUBLIK, PESANAN SAYA, NOTIFIKASI ================= */
function maskName(name){
  const p=String(name||"").trim().split(/\s+/).filter(Boolean);
  if(!p.length)return "Pelanggan";
  if(p.length===1)return p[0].slice(0,3)+"***";
  return p[0]+" "+p[p.length-1][0].toUpperCase()+".";
}
const approvalClass={Menunggu:"pending",Disetujui:"approved",Ditolak:"rejected",Dibatalkan:"cancelled"};
const approvalBadge=a=>`<span class="status ${approvalClass[a]||"pending"}">${escapeHtml(a)}</span>`;
const payBadge=t=>`<span class="status ${t.status==="Lunas"?"paid":t.status==="Dikembalikan"?"cancelled":"unpaid"}">${escapeHtml(t.status)}</span>`;
const emptyState=(icon,title,text)=>`<div class="empty-state"><span class="empty-icon">${icon}</span><strong>${title}</strong><p>${text}</p></div>`;
// pelanggan bisa membatalkan kapan saja selama pesanan masih aktif, termasuk setelah bayar atau disetujui (dana dikembalikan, simulasi)
const canCancel=t=>isActive(apr(t));
const needsAction=t=>apr(t)==="Menunggu"&&t.status==="Lunas"; // sudah bayar, menunggu keputusan fotografer

function renderPublicFeed(){
  const list=publicCache.filter(p=>{const a=p.approval||"Disetujui";return isActive(a)&&(a==="Disetujui"||p.status==="Lunas")}).slice(0,9);
  $("publicFeed").innerHTML=list.length?list.map(p=>`<div class="feed-item"><div class="feed-avatar">${escapeHtml((p.maskedName||"?")[0].toUpperCase())}</div><div class="feed-info"><strong>${escapeHtml(p.maskedName)}</strong><span>${escapeHtml(p.packageName)} · ${dFmt(p.date,{day:"2-digit",month:"short",year:"numeric"})}</span></div>${approvalBadge(p.approval||"Disetujui")}</div>`).join(""):emptyState("✦","Belum ada pesanan","Jadilah yang pertama memesan jadwal pemotretan bersama LensaKita.");
}
function renderMine(){
  $("myRows").innerHTML=myCache.length?myCache.map(t=>`<tr><td>${escapeHtml(t.id)}</td><td>${escapeHtml(t.packageName)}</td><td>${dFmt(t.date)}</td><td>${money(t.price)}</td><td>${approvalBadge(apr(t))}</td><td>${payBadge(t)}</td><td>${t.status==="Belum dibayar"&&isActive(apr(t))?`<button class="table-action pay" data-pay="${escapeHtml(t.id)}">Bayar</button>`:""}<button class="table-action" data-my="${escapeHtml(t.id)}">Invoice</button>${canCancel(t)?`<button class="table-action danger" data-cancel="${escapeHtml(t.id)}">Batalkan</button>`:""}</td></tr>`).join(""):`<tr><td colspan="7">${emptyState("🗓","Belum ada pesanan","Pilih paket dan tanggal di bagian Pesan untuk membuat pesanan pertamamu.")}</td></tr>`;
  document.querySelectorAll("[data-my]").forEach(b=>b.addEventListener("click",()=>openInvoice(b.dataset.my)));
  document.querySelectorAll("[data-cancel]").forEach(b=>b.addEventListener("click",()=>cancelOrder(b.dataset.cancel)));
  document.querySelectorAll("[data-pay]").forEach(b=>b.addEventListener("click",()=>openPay(b.dataset.pay)));
}
function historyHtml(tx){
  const h=(tx.history&&tx.history.length)?tx.history:[{time:tx.createdAt,action:"Pesanan dibuat",method:"-",ref:"-",status:"Belum dibayar"}].concat(tx.status==="Lunas"?[{time:tx.paidAt,action:"Pembayaran diterima",method:tx.method,ref:"-",status:"Lunas"}]:[]);
  return `<h4 class="history-title">Riwayat pesanan &amp; pembayaran</h4><table class="history-table"><thead><tr><th>Waktu</th><th>Aktivitas</th><th>Metode</th><th>Ref</th><th>Status</th></tr></thead><tbody>${h.map(x=>`<tr><td>${new Date(x.time).toLocaleString("id-ID")}</td><td>${escapeHtml(x.action)}</td><td>${escapeHtml(x.method||"-")}</td><td>${escapeHtml(x.ref||"-")}</td><td>${escapeHtml(x.status)}</td></tr>`).join("")}</tbody></table>`;
}

// notifikasi untuk user: toast realtime + daftar di ikon lonceng
function notifyChanges(){
  myCache.forEach(t=>{
    const prev=notifPrev.get(t.id),cur=apr(t);
    if(!firstMine&&prev&&prev!==cur){
      if(cur==="Disetujui")showToast(`Pesanan ${t.id} disetujui fotografer.`);
      else if(cur==="Ditolak")showToast(`Pesanan ${t.id} ditolak: ${t.decisionReason||"jadwal penuh"}. Dana dikembalikan.`);
    }
    notifPrev.set(t.id,cur);
  });
  firstMine=false;
}
const notifItems=()=>myCache.filter(t=>t.decidedAt&&["Disetujui","Ditolak"].includes(apr(t))).sort((a,b)=>new Date(b.decidedAt)-new Date(a.decidedAt));
function renderNotif(){
  const items=notifItems(),unread=items.filter(t=>t.notifRead===false).length;
  $("notifBadge").textContent=unread;$("notifBadge").hidden=!unread;
  $("notifList").innerHTML=items.length?items.map(t=>{
    const ok=apr(t)==="Disetujui";
    const msg=ok?`Pesanan ${escapeHtml(t.id)} (${escapeHtml(t.packageName)}) untuk tanggal ${dFmt(t.date)} disetujui fotografer. Sampai jumpa di jadwal pemotretan.`:`Pesanan ${escapeHtml(t.id)} untuk tanggal ${dFmt(t.date)} ditolak. Alasan: ${escapeHtml(t.decisionReason||"Jadwal penuh")}. Dana ${money(t.price)} dikembalikan (simulasi). Silakan pilih tanggal lain.`;
    return `<div class="notif-item ${ok?"ok":"no"} ${t.notifRead===false?"unread":""}"><strong>${ok?"Pesanan disetujui":"Pesanan ditolak"}</strong><p>${msg}</p><span>${new Date(t.decidedAt).toLocaleString("id-ID")}</span>${ok?`<div><button class="table-action" data-notif-inv="${escapeHtml(t.id)}">Buka invoice</button></div>`:""}</div>`;
  }).join(""):emptyState("🔔","Belum ada notifikasi","Kabar persetujuan atau perubahan jadwal dari fotografer akan muncul di sini.");
}
function openNotif(){
  $("notifModal").classList.add("show");$("notifModal").setAttribute("aria-hidden","false");
  notifItems().filter(t=>t.notifRead===false).forEach(t=>updateDoc(doc(db,"transaksi",t.id),{notifRead:true}).catch(console.error));
}
function closeNotif(){$("notifModal").classList.remove("show");$("notifModal").setAttribute("aria-hidden","true")}
$("notifBtn").addEventListener("click",openNotif);
$("closeNotif").addEventListener("click",closeNotif);
$("notifModal").addEventListener("click",e=>{if(e.target===$("notifModal"))closeNotif()});
$("notifList").addEventListener("click",e=>{const b=e.target.closest("[data-notif-inv]");if(b){closeNotif();openInvoice(b.dataset.notifInv)}});

/* ================= PAKET & PEMESANAN ================= */
function renderPackages(){
  $("packageGrid").innerHTML=packages.map((p,i)=>`<article class="package-card ${i===2?"featured":""}" data-id="${p.id}" tabindex="0" role="button" aria-label="Pilih paket ${p.name}"><div class="package-photo pp-${p.id}" style="--img:url('${p.img}')"></div>${p.tag?`<span class="package-tag">${p.tag}</span>`:""}<span class="package-number">0${i+1}</span><h3>${p.name}</h3><p>${p.desc}</p><div class="package-price">${money(p.price)} <small>/ paket</small></div></article>`).join("");
  $("packageSelect").innerHTML='<option value="">Pilih paket layanan</option>'+packages.map(p=>`<option value="${p.id}">${p.name} — ${money(p.price)}</option>`).join("");
}
function selectedPackage(){return packages.find(p=>p.id===$("packageSelect").value)}
$("packageSelect").addEventListener("change",()=>{$("bookingPrice").textContent=money(selectedPackage()?.price||0);syncSelectedCard()});
$("serviceDate").min=todayISO();
const slotsUsed=date=>publicCache.filter(p=>p.date===date&&isActive(p.approval||"Disetujui")).length;
function updateSlotInfo(){
  const el=$("slotInfo");if(!el)return;
  const d=$("serviceDate").value;
  if(!d){el.textContent=`Maksimal ${MAX_PER_DAY} pelanggan per hari. Pilih tanggal untuk melihat sisa slot.`;el.className="tiny slot";return}
  const left=MAX_PER_DAY-slotsUsed(d);
  el.textContent=left>0?`Sisa slot tanggal ini: ${left} dari ${MAX_PER_DAY}.`:`Jadwal tanggal ini sudah penuh (${MAX_PER_DAY}/${MAX_PER_DAY}). Silakan pilih tanggal lain.`;
  el.className="tiny slot "+(left>0?"ok":"full");
}
$("serviceDate").addEventListener("input",updateSlotInfo);
$("bookingForm").addEventListener("submit",e=>{
  e.preventDefault();
  if(isAdmin||isPhotog){showToast("Akun admin/fotografer tidak dapat membuat pesanan.");return}
  if(!currentUser){showToast("Masuk atau daftar dulu untuk memesan.");openLogin();return}
  const pkg=selectedPackage();if(!pkg){showToast("Pilih paket terlebih dahulu.");return}
  const date=$("serviceDate").value;
  if(slotsUsed(date)>=MAX_PER_DAY){showToast(`Jadwal ${dFmt(date)} sudah penuh (maks. ${MAX_PER_DAY} pelanggan/hari). Pilih tanggal lain.`);updateSlotInfo();return}
  const now=new Date().toISOString();
  const tx={id:invoiceNumber(),uid:currentUser.uid,email:currentUser.email,name:$("customerName").value.trim(),contact:$("customerContact").value.trim(),packageId:pkg.id,packageName:pkg.name,price:pkg.price,date,notes:$("notes").value.trim(),createdAt:now,status:"Belum dibayar",method:"-",paidAt:null,
    approval:"Menunggu",decisionReason:"",decidedAt:null,notifRead:true,
    history:[{time:now,action:"Pesanan dibuat, menunggu pembayaran",method:"-",ref:"-",status:"Belum dibayar"}]};
  localTx.set(tx.id,tx);
  setDoc(doc(db,"transaksi",tx.id),tx).catch(err=>{console.error(err);showToast("Gagal menyimpan ke database.")});
  // feed publik: hanya nama disamarkan, paket, tanggal, status (tanpa kontak & harga)
  setDoc(doc(db,"pesanan_publik",tx.id),{id:tx.id,maskedName:maskName(tx.name),packageName:tx.packageName,date:tx.date,createdAt:now,status:tx.status,approval:"Menunggu"}).catch(console.error);
  openInvoice(tx.id,tx);$("bookingForm").reset();$("customerContact").value=currentUser.email;$("bookingPrice").textContent=money(0);syncSelectedCard();updateSlotInfo();
  showToast("Pesanan dibuat. Selesaikan pembayaran agar fotografer dapat meninjau.");
  setTimeout(()=>openPay(tx.id),350);
});

/* ================= INVOICE ================= */
function openInvoice(id,txGiven){const tx=txGiven||findTx(id);if(!tx)return;currentInvoiceId=id;renderInvoice(tx);$("invoiceModal").classList.add("show");$("invoiceModal").setAttribute("aria-hidden","false")}
function closeInvoice(){$("invoiceModal").classList.remove("show");$("invoiceModal").setAttribute("aria-hidden","true")}
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

function stepperHtml(tx){
  const a=apr(tx),paidEver=tx.status==="Lunas"||tx.status==="Dikembalikan",closed=a==="Ditolak"||a==="Dibatalkan";
  const s2=`<li class="${paidEver?"done":(closed?"":"now")}"><b>${paidEver?"✓":"2"}</b><span>${paidEver?"Pembayaran diterima":"Menunggu pembayaran"}</span></li>`;
  const s3=closed?`<li class="bad"><b>✕</b><span>${a}</span></li>`:a==="Disetujui"?`<li class="done"><b>✓</b><span>Disetujui fotografer</span></li>`:`<li class="${paidEver?"now":""}"><b>3</b><span>${paidEver?"Menunggu persetujuan":"Persetujuan fotografer"}</span></li>`;
  return `<ol class="stepper"><li class="done"><b>✓</b><span>Pesanan dibuat</span></li>${s2}${s3}</ol>`;
}

function renderInvoice(tx){
  const ap=apr(tx),paid=tx.status==="Lunas",refunded=tx.status==="Dikembalikan";
  const date=new Date(tx.createdAt).toLocaleDateString("id-ID",{day:"2-digit",month:"long",year:"numeric"});
  const serviceDate=dFmt(tx.date);
  const mine=!!currentUser&&tx.uid===currentUser.uid&&!isAdmin&&!isPhotog;
  const stamp=ap==="Ditolak"?'<span class="paid-stamp red">DITOLAK</span>':ap==="Dibatalkan"?'<span class="paid-stamp grey">DIBATALKAN</span>':ap==="Disetujui"&&paid?'<span class="paid-stamp">DISETUJUI</span>':`<span class="invoice-label">${paid?"MENUNGGU PERSETUJUAN":"MENUNGGU PEMBAYARAN"}</span>`;
  const payBox=`<div class="payment-box"><h3>Selesaikan pembayaran</h3><p class="invoice-note">Bayar lewat QRIS, e-wallet, atau virtual account (semua cashless). Fotografer baru meninjau pesanan setelah pembayaran diterima.</p><div class="payment-controls"><button class="btn primary" id="openPay">Pilih Metode Pembayaran</button><button class="btn ghost" id="cancelOrder">Batalkan Pesanan</button></div></div>`;
  let action="";
  if(mine){
    if(ap==="Menunggu"&&!paid)action=payBox;
    else if(ap==="Menunggu"&&paid)action=`<div class="payment-box"><h3>Pembayaran diterima</h3><p class="invoice-note">Pesanan sedang menunggu persetujuan fotografer. Kamu akan menerima notifikasi begitu ada keputusan. Jika ditolak, dana dikembalikan otomatis (simulasi).</p><div class="payment-controls"><button class="btn ghost" id="cancelOrder">Batalkan Pesanan</button></div></div>`;
    else if(ap==="Disetujui"&&!paid)action=payBox;
    else if(ap==="Disetujui")action=`<div class="payment-box ok"><h3>Pesanan disetujui</h3><p class="invoice-note">Pembayaran sudah diterima dan fotografer menyetujui jadwal ${serviceDate}. Sampai jumpa di hari pemotretan. Jika berhalangan, kamu masih bisa membatalkan dan dana dikembalikan (simulasi).</p><div class="payment-controls"><button class="btn ghost" id="cancelOrder">Batalkan Pesanan</button></div></div>`;
    else if(ap==="Ditolak")action=`<div class="payment-box reject"><h3>Pesanan ditolak</h3><p class="invoice-note">Alasan: ${escapeHtml(tx.decisionReason||"Jadwal pada tanggal tersebut penuh.")}${refunded?` Dana ${money(tx.price)} sudah dikembalikan (simulasi).`:""} Silakan pilih tanggal lain.</p><div class="payment-controls"><button class="btn primary" id="newOrder">Buat Pesanan Baru</button></div></div>`;
  }
  const extra=(ap==="Ditolak"?`<br>Alasan penolakan: ${escapeHtml(tx.decisionReason||"-")}`:"")+(ap==="Dibatalkan"?`<br>Alasan pembatalan: ${escapeHtml(tx.cancelReason||"-")}`:"");
  $("invoiceContent").innerHTML=`
    <div class="invoice-head"><div><span class="invoice-label">INVOICE / ${escapeHtml(tx.id)}</span><h2>LensaKita Studio</h2><p>Jasa Fotografi & Videografi<br>Dokumentasi momen berharga Anda.</p></div><div>${stamp}<p>Tanggal invoice: ${date}<br>Tanggal layanan: ${serviceDate}</p></div></div>
    ${stepperHtml(tx)}
    ${action}
    <div class="invoice-meta"><div><h4>Ditagihkan kepada</h4><strong>${escapeHtml(tx.name)}</strong><p>${escapeHtml(tx.contact)}</p></div><div><h4>Detail pesanan</h4><strong>${escapeHtml(tx.packageName)}</strong><p>${escapeHtml(tx.notes||"Tidak ada catatan tambahan.")}</p></div></div>
    <table><thead><tr><th>Deskripsi</th><th>Jumlah</th><th>Harga</th></tr></thead><tbody><tr><td>${escapeHtml(tx.packageName)}</td><td>1 paket</td><td>${money(tx.price)}</td></tr></tbody></table>
    <div class="invoice-total"><span>Total pembayaran</span><strong>${money(tx.price)}</strong></div>
    ${historyHtml(tx)}
    <p class="invoice-note">Pembayaran: <strong>${escapeHtml(tx.status)}</strong> · Persetujuan: <strong>${escapeHtml(ap)}</strong>${(paid||refunded)&&tx.paidAt?`<br>Metode: ${escapeHtml(tx.method)}<br>Waktu pembayaran: ${new Date(tx.paidAt).toLocaleString("id-ID")}`:""}${extra}<br><br>Terima kasih telah memilih LensaKita Studio. Simpan invoice ini sebagai bukti pemesanan. Untuk versi tugas ini, pembayaran merupakan simulasi cashless dan bukan transaksi uang sungguhan.</p>`;
  if($("openPay"))$("openPay").addEventListener("click",()=>openPay(tx.id));
  if($("cancelOrder"))$("cancelOrder").addEventListener("click",()=>cancelOrder(tx.id));
  if($("newOrder"))$("newOrder").addEventListener("click",()=>{closeInvoice();location.hash="#pesan"});
}

/* ----- tampilan pembayaran cashless (QRIS, e-wallet, virtual account) ----- */
const wallets=[["gopay","GoPay","#00aa5b"],["ovo","OVO","#4c2a86"],["dana","DANA","#118eea"],["shopeepay","ShopeePay","#ee4d2d"]];
const banks=[["bca","BCA","#0060af","39"],["bri","BRI","#00529c","88"],["mandiri","Mandiri","#003d79","89"],["bni","BNI","#e2711d","98"]];
let payTxId=null,payGroup="qris",payWallet="gopay",payBank="bca",payPhone="";
const chip=(n,c)=>`<span class="logo-chip" style="background:${c}">${n}</span>`;
const API = "https://lensakita-studio.vercel.app";

async function openPay(id){
  try{
    showToast("Menyiapkan pembayaran...");
    const idToken = await currentUser.getIdToken();
    const r = await fetch(API+"/api/create-payment",{
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:"Bearer "+idToken},
      body:JSON.stringify({id})
    });
    const d = await r.json();
    if(!r.ok) throw new Error(JSON.stringify(d.error));
    window.snap.pay(d.token,{
      onSuccess:()=>showToast("Pembayaran berhasil, mengonfirmasi..."),
      onPending:()=>showToast("Menunggu pembayaran kamu."),
      onError:()=>showToast("Pembayaran gagal."),
      onClose:()=>showToast("Popup ditutup. Bisa dilanjutkan dari Pesanan Saya.")
    });
  }catch(err){console.error(err);showToast("Gagal membuka pembayaran.")}
}
function closePay(){clearInterval(payTimer);$("payModal").classList.remove("show");$("payModal").setAttribute("aria-hidden","true")}
$("payModal").addEventListener("click",e=>{if(e.target===$("payModal"))closePay()});

function renderPay(){
  clearInterval(payTimer);
  const tx=findTx(payTxId);if(!tx){closePay();return}
  const w=wallets.find(x=>x[0]===payWallet),bk=banks.find(x=>x[0]===payBank);
  const vaNo=bk[3]+"0"+tx.id.replace(/\D/g,"").padStart(12,"0");
  let detail="";
  if(payGroup==="qris"){
    if(!qrExpiry.has(tx.id))qrExpiry.set(tx.id,Date.now()+15*60*1000);
    detail=`<div class="pay-detail-head"><strong>Bayar dengan QRIS</strong><p>Scan kode QR memakai aplikasi e-wallet atau mobile banking apa pun.</p></div>
      <div class="qris-box"><div class="qris-head"><strong>QRIS</strong><span>LENSAKITA STUDIO</span></div><div class="qris-code">${fakeQrSvg(tx.id)}</div><div class="qris-amount">${money(tx.price)}</div><p class="qris-timer">Berlaku <strong id="qrisTimer">15:00</strong> <button type="button" class="link-btn" id="refreshQr">Perbarui QR</button></p></div>
      <button class="btn primary" id="payConfirm">Simulasikan Scan & Bayar</button>`;
  }else if(payGroup==="ewallet"){
    detail=`<div class="pay-detail-head"><strong>Bayar dengan E-Wallet</strong><p>Pilih dompet digital, lalu masukkan nomor HP yang terdaftar.</p></div>
      <div class="logo-grid">${wallets.map(x=>`<button type="button" class="logo-pick ${x[0]===payWallet?"active":""}" data-wallet="${x[0]}">${chip(x[1],x[2])}</button>`).join("")}</div>
      <label>Nomor HP ${w[1]}<input id="payPhone" inputmode="numeric" maxlength="14" placeholder="08xxxxxxxxxx" value="${escapeHtml(payPhone)}"></label>
      <button class="btn primary" id="payConfirm">Bayar ${money(tx.price)} dengan ${w[1]}</button>`;
  }else{
    detail=`<div class="pay-detail-head"><strong>Transfer Virtual Account</strong><p>Pilih bank, lalu transfer ke nomor virtual account di bawah.</p></div>
      <div class="logo-grid">${banks.map(x=>`<button type="button" class="logo-pick ${x[0]===payBank?"active":""}" data-bank="${x[0]}">${chip(x[1],x[2])}</button>`).join("")}</div>
      <div class="va-box"><div><small>Nomor Virtual Account ${bk[1]}</small><span>${vaNo}</span></div><button type="button" class="link-btn" id="copyVa">Salin</button></div>
      <ol class="pay-steps"><li>Buka aplikasi mobile banking ${bk[1]}.</li><li>Pilih Transfer, lalu Virtual Account.</li><li>Masukkan nomor di atas dan nominal ${money(tx.price)}.</li></ol>
      <button class="btn primary" id="payConfirm">Simulasikan Transfer</button>`;
  }
  const group=(id,logos,title,sub)=>`<button type="button" class="pay-method ${payGroup===id?"active":""}" data-group="${id}"><div class="chip-row">${logos}</div><div><strong>${title}</strong><small>${sub}</small></div></button>`;
  $("payContent").innerHTML=`
    <div class="pay-head"><div><span class="invoice-label">PAYMENT GATEWAY · SIMULASI CASHLESS</span><h2>${money(tx.price)}</h2><p>Invoice ${escapeHtml(tx.id)} · ${escapeHtml(tx.packageName)}</p></div><button class="btn ghost" id="closePay">Tutup</button></div>
    <div class="pay-layout">
      <div class="pay-methods">
        ${group("qris",chip("QRIS","#c8102e"),"QRIS","Scan dengan aplikasi apa pun")}
        ${group("ewallet",wallets.map(x=>chip(x[1],x[2])).join(""),"E-Wallet","GoPay, OVO, DANA, ShopeePay")}
        ${group("va",banks.map(x=>chip(x[1],x[2])).join(""),"Virtual Account","BCA, BRI, Mandiri, BNI")}
      </div>
      <div class="pay-detail">${detail}</div>
    </div>
    <p class="invoice-note">Tanpa pembayaran tunai. Setelah bayar, pesanan menunggu persetujuan fotografer; jika ditolak, dana dikembalikan otomatis. Ini simulasi dan tidak memotong saldo sungguhan.</p>`;
  $("closePay").onclick=closePay;
  document.querySelectorAll("[data-group]").forEach(b=>b.onclick=()=>{payGroup=b.dataset.group;renderPay()});
  document.querySelectorAll("[data-wallet]").forEach(b=>b.onclick=()=>{payPhone=$("payPhone")?.value||payPhone;payWallet=b.dataset.wallet;renderPay()});
  document.querySelectorAll("[data-bank]").forEach(b=>b.onclick=()=>{payBank=b.dataset.bank;renderPay()});
  $("payConfirm").onclick=()=>confirmPay(tx.id);
  if($("copyVa"))$("copyVa").onclick=()=>{navigator.clipboard?.writeText(vaNo).then(()=>showToast("Nomor virtual account disalin.")).catch(()=>showToast("Salin manual: "+vaNo))};
  if(payGroup==="qris"){
    const tick=()=>{
      const left=qrExpiry.get(tx.id)-Date.now(),t=$("qrisTimer"),btn=$("payConfirm");if(!t)return;
      if(left<=0){t.textContent="KEDALUWARSA";if(btn)btn.disabled=true;return}
      t.textContent=fmtCountdown(left);
    };
    $("refreshQr").onclick=()=>{qrExpiry.set(tx.id,Date.now()+15*60*1000);$("payConfirm").disabled=false;tick();showToast("QR diperbarui.")};
    tick();payTimer=setInterval(tick,1000);
  }
}

async function confirmPay(id){
  const tx=findTx(id);if(!tx)return;
  if(!isActive(apr(tx))||tx.status==="Lunas"){showToast("Pesanan ini tidak dapat dibayar.");return}
  let method;
  if(payGroup==="qris")method="QRIS (simulasi)";
  else if(payGroup==="ewallet"){
    const phone=($("payPhone").value||"").trim();
    if(!/^\d{9,14}$/.test(phone)){showToast("Masukkan nomor HP yang valid (9 sampai 14 digit).");return}
    payPhone=phone;method=`E-Wallet ${wallets.find(x=>x[0]===payWallet)[1]} (simulasi)`;
  }else method=`Virtual Account ${banks.find(x=>x[0]===payBank)[1]} (simulasi)`;
  const btn=$("payConfirm");btn.disabled=true;btn.textContent="Memverifikasi pembayaran...";
  await new Promise(r=>setTimeout(r,1600));
  await markPaid(tx,method);
  closePay();
}
async function markPaid(tx,method){
  const now=new Date().toISOString();
  const ref="PAY-"+Math.random().toString(36).slice(2,8).toUpperCase();
  const base=(tx.history&&tx.history.length)?tx.history:[{time:tx.createdAt,action:"Pesanan dibuat",method:"-",ref:"-",status:"Belum dibayar"}];
  const upd={status:"Lunas",method,paidAt:now,payRef:ref,history:[...base,{time:now,action:"Pembayaran diterima, menunggu persetujuan fotografer",method,ref,status:"Lunas"}]};
  updateDoc(doc(db,"transaksi",tx.id),upd).catch(err=>{console.error(err);showToast("Gagal menyimpan pembayaran.")});
  updateDoc(doc(db,"pesanan_publik",tx.id),{status:"Lunas"}).catch(console.error);
  const updated={...tx,...upd};
  localTx.set(tx.id,updated);
  renderInvoice(updated);showToast("Pembayaran berhasil. Pesanan menunggu persetujuan fotografer.");
  confetti(window.innerWidth/2,window.innerHeight*0.35);
}

/* ----- jendela alasan (dipakai untuk pembatalan & penolakan) ----- */
let reasonCb=null;
function askReason({eyebrow,title,desc,presets,okLabel,onConfirm}){
  $("reasonEyebrow").textContent=eyebrow;$("reasonTitle").textContent=title;$("reasonDesc").textContent=desc;$("reasonOk").textContent=okLabel;
  $("reasonPreset").innerHTML=presets.map(p=>`<option>${escapeHtml(p)}</option>`).join("");
  $("reasonText").value="";reasonCb=onConfirm;
  $("reasonModal").classList.add("show");$("reasonModal").setAttribute("aria-hidden","false");
}
function closeReason(){$("reasonModal").classList.remove("show");$("reasonModal").setAttribute("aria-hidden","true");reasonCb=null}
$("reasonCancel").addEventListener("click",closeReason);
$("reasonModal").addEventListener("click",e=>{if(e.target===$("reasonModal"))closeReason()});
$("reasonForm").addEventListener("submit",e=>{
  e.preventDefault();
  const extra=$("reasonText").value.trim(),r=$("reasonPreset").value+(extra?" — "+extra:""),cb=reasonCb;
  closeReason();if(cb)cb(r);
});

// pembatalan oleh pelanggan (jika sudah bayar, dana dikembalikan)
function cancelOrder(id){
  const tx=findTx(id);if(!tx||!canCancel(tx))return;
  const paid=tx.status==="Lunas";
  askReason({eyebrow:"PEMBATALAN PESANAN",title:"Batalkan pesanan?",desc:`Pesanan ${id} akan dibatalkan dan slot tanggal ${dFmt(tx.date)} dilepas.${paid?" Dana akan dikembalikan (simulasi).":""}`,
    presets:["Berubah rencana","Salah memilih paket atau tanggal","Menemukan layanan lain","Lainnya"],okLabel:"Ya, Batalkan",
    onConfirm:reason=>{
      const now=new Date().toISOString();
      const base=(tx.history&&tx.history.length)?tx.history:[{time:tx.createdAt,action:"Pesanan dibuat",method:"-",ref:"-",status:"Belum dibayar"}];
      const hist=[...base,{time:now,action:"Dibatalkan oleh pelanggan: "+reason,method:"-",ref:"-",status:"Dibatalkan"}];
      const upd={approval:"Dibatalkan",cancelReason:reason,cancelledAt:now};
      if(paid){upd.status="Dikembalikan";upd.refundedAt=now;hist.push({time:now,action:"Dana dikembalikan ke pelanggan (simulasi)",method:tx.method,ref:tx.payRef||"-",status:"Dikembalikan"})}
      upd.history=hist;
      updateDoc(doc(db,"transaksi",id),upd).catch(err=>{console.error(err);showToast("Gagal membatalkan pesanan.")});
      updateDoc(doc(db,"pesanan_publik",id),{approval:"Dibatalkan"}).catch(console.error);
      const updated={...tx,...upd};localTx.set(id,updated);
      if(currentInvoiceId===id)renderInvoice(updated);
      showToast(paid?"Pesanan dibatalkan. Dana dikembalikan (simulasi).":"Pesanan dibatalkan.");
    }});
}

// keputusan fotografer (hanya untuk pesanan yang sudah dibayar): setujui, atau tolak dengan alasan + refund
function applyDecision(tx,decision,reason){
  const now=new Date().toISOString();
  const base=(tx.history&&tx.history.length)?tx.history:[{time:tx.createdAt,action:"Pesanan dibuat",method:"-",ref:"-",status:"Menunggu"}];
  const hist=[...base,{time:now,action:decision==="Disetujui"?"Disetujui oleh fotografer":"Ditolak oleh fotografer: "+reason,method:"-",ref:"-",status:decision}];
  const upd={approval:decision,decisionReason:reason||"",decidedAt:now,notifRead:false};
  if(decision==="Ditolak"){upd.status="Dikembalikan";upd.refundedAt=now;hist.push({time:now,action:"Dana dikembalikan ke pelanggan (simulasi)",method:tx.method,ref:tx.payRef||"-",status:"Dikembalikan"})}
  upd.history=hist;
  updateDoc(doc(db,"transaksi",tx.id),upd).catch(err=>{console.error(err);showToast("Gagal menyimpan keputusan. Cek Rules Firestore.")});
  updateDoc(doc(db,"pesanan_publik",tx.id),{approval:decision}).catch(console.error);
  showToast(decision==="Disetujui"?`Pesanan ${tx.id} disetujui.`:`Pesanan ${tx.id} ditolak. Pelanggan diberi notifikasi dan dana dikembalikan.`);
}
function decideOrder(id,decision){
  const tx=findTx(id);if(!tx)return;
  if(!needsAction(tx)){showToast("Pesanan baru bisa diputuskan setelah pelanggan membayar.");return}
  if(decision==="Disetujui"){applyDecision(tx,"Disetujui","");return}
  askReason({eyebrow:"TOLAK PESANAN",title:"Tolak pesanan ini?",desc:`Pelanggan akan menerima notifikasi untuk tanggal ${dFmt(tx.date)} dan dana dikembalikan.`,
    presets:["Jadwal pada tanggal tersebut penuh","Fotografer berhalangan hadir","Lokasi di luar jangkauan","Lainnya"],okLabel:"Tolak Pesanan",
    onConfirm:r=>applyDecision(tx,"Ditolak",r)});
}

/* ================= DASHBOARD (ADMIN) ================= */
function filteredTransactions(){
  const data=loadTransactions(),filter=$("reportFilter").value,now=new Date();
  return data.filter(t=>{const d=new Date(t.createdAt);if(filter==="week"){const start=new Date(now);start.setDate(now.getDate()-6);start.setHours(0,0,0,0);return d>=start&&d<=now}if(filter==="month")return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear();return true});
}
function renderDashboard(){
  const data=filteredTransactions();
  const paid=data.filter(t=>t.status==="Lunas").reduce((s,t)=>s+t.price,0);
  const unpaid=data.filter(t=>t.status!=="Lunas"&&isActive(apr(t))).reduce((s,t)=>s+t.price,0);
  $("totalTransactions").textContent=data.length;$("totalRevenue").textContent=money(paid);$("unpaidTotal").textContent=money(unpaid);
  const f=$("reportFilter").value;$("reportRange").textContent=f==="week"?"7 hari terakhir":f==="month"?"Bulan ini":"Semua periode";
  $("transactionRows").innerHTML=data.length?data.map(t=>`<tr><td>${escapeHtml(t.id)}</td><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.packageName)}</td><td>${dFmt(t.date)}</td><td>${money(t.price)}</td><td>${approvalBadge(apr(t))}</td><td>${payBadge(t)}</td><td><button class="table-action" data-invoice="${escapeHtml(t.id)}">Invoice</button></td></tr>`).join(""):`<tr><td colspan="8">${emptyState("📊","Belum ada transaksi","Transaksi pelanggan akan muncul di sini setelah ada pesanan masuk pada periode ini.")}</td></tr>`;
  document.querySelectorAll("[data-invoice]").forEach(btn=>btn.addEventListener("click",()=>openInvoice(btn.dataset.invoice)));
}
$("reportFilter").addEventListener("change",renderDashboard);
$("exportCsv").addEventListener("click",()=>{
  if(!isAdmin)return;
  const rows=filteredTransactions();if(!rows.length){showToast("Belum ada data untuk diunduh.");return}
  const header=["Invoice","Nama","Kontak","Paket","Tanggal Layanan","Total","Persetujuan","Alasan","Status Pembayaran","Metode Pembayaran","Tanggal Transaksi"];
  const csv=[header,...rows.map(t=>[t.id,t.name,t.contact,t.packageName,t.date,t.price,apr(t),t.decisionReason||t.cancelReason||"",t.status,t.method,t.createdAt])].map(row=>row.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\r\n");
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

/* ================= PANEL FOTOGRAFER ================= */
let pFilter="Menunggu";
function renderPhotog(){
  if(!$("pgRows"))return;
  const by=a=>cache.filter(t=>apr(t)===a);
  $("pgPending").textContent=cache.filter(needsAction).length;$("pgApproved").textContent=by("Disetujui").length;$("pgRejected").textContent=by("Ditolak").length;
  const dates={};cache.filter(t=>isActive(apr(t))).forEach(t=>{(dates[t.date]=dates[t.date]||[]).push(t)});
  const keys=Object.keys(dates).sort();
  $("pgBusy").textContent=keys.length;
  $("scheduleChips").innerHTML=keys.length?keys.map(d=>{
    const n=dates[d].length,pend=dates[d].filter(needsAction).length;
    return `<div class="chip-date ${n>=MAX_PER_DAY?"full":""}"><strong>${dFmt(d,{day:"2-digit",month:"short",year:"numeric"})}</strong><span>${n}/${MAX_PER_DAY} pelanggan${n>=MAX_PER_DAY?" · PENUH":""}${pend?` · ${pend} perlu keputusan`:""}</span></div>`;
  }).join(""):emptyState("📅","Belum ada jadwal","Pesanan yang masuk akan muncul di sini, dikelompokkan per tanggal layanan.");
  document.querySelectorAll("#pgTabs [data-pf]").forEach(b=>b.classList.toggle("active",b.dataset.pf===pFilter));
  const flt={"Menunggu":needsAction,"Disetujui":t=>apr(t)==="Disetujui","Ditolak":t=>apr(t)==="Ditolak","Belum bayar":t=>apr(t)==="Menunggu"&&t.status!=="Lunas","Semua":()=>true};
  const rows=cache.filter(flt[pFilter]||(()=>true)).slice().sort((a,b)=>a.date.localeCompare(b.date));
  $("pgRows").innerHTML=rows.length?rows.map(t=>{
    const a=apr(t),n=(dates[t.date]||[]).length;
    const acts=needsAction(t)?`<button class="btn primary sm" data-decide="Disetujui" data-id="${escapeHtml(t.id)}">Setujui</button><button class="btn danger sm" data-decide="Ditolak" data-id="${escapeHtml(t.id)}">Tolak</button>`:(a==="Menunggu"?`<span class="cell-sub">Menunggu pembayaran pelanggan</span>`:"");
    return `<tr><td>${escapeHtml(t.id)}</td><td>${escapeHtml(t.name)}<span class="cell-sub">${escapeHtml(t.contact)}</span>${t.notes?`<span class="cell-sub">Catatan: ${escapeHtml(t.notes)}</span>`:""}</td><td>${escapeHtml(t.packageName)}</td><td>${dFmt(t.date)}</td><td>${n}/${MAX_PER_DAY}</td><td>${approvalBadge(a)} ${payBadge(t)}</td><td class="act-cell">${acts}<button class="table-action" data-pg-inv="${escapeHtml(t.id)}">Invoice</button></td></tr>`;
  }).join(""):`<tr><td colspan="7">${emptyState("📥",pFilter==="Menunggu"?"Belum ada pesanan yang perlu diputuskan":"Tidak ada data",pFilter==="Menunggu"?"Pesanan yang sudah dibayar pelanggan akan muncul di sini untuk disetujui atau ditolak.":"Data pada kategori ini akan tampil di sini.")}</td></tr>`;
  document.querySelectorAll("[data-decide]").forEach(b=>b.addEventListener("click",()=>decideOrder(b.dataset.id,b.dataset.decide)));
  document.querySelectorAll("[data-pg-inv]").forEach(b=>b.addEventListener("click",()=>openInvoice(b.dataset.pgInv)));
}
$("pgTabs").addEventListener("click",e=>{const b=e.target.closest("[data-pf]");if(!b)return;pFilter=b.dataset.pf;renderPhotog()});

/* ================= INISIALISASI ================= */
renderPackages();
renderDashboard();
renderPhotog();
renderMine();
renderNotif();
updateSlotInfo();
// feed publik: realtime, bisa dilihat semua pengunjung
onSnapshot(pubCol,snap=>{
  publicCache=snap.docs.map(d=>d.data()).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  renderPublicFeed();updateSlotInfo();
},err=>console.error(err));
renderPublicFeed();
setupPackageEffects();
setupReveal();
setupHeroEffects();
setupGlobalEffects();

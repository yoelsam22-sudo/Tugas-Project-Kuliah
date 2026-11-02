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

/* ================= EFEK VISUAL ================= */
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const rnd = (a,b) => a + Math.random()*(b-a);

// satu gelembung: muncul di (x,y) lalu melayang ke arah (dx,dy) dan hilang
function spawnBubble(x,y,{size=rnd(10,28),dx=0,dy=0,duration=900}={}){
  if(reduceMotion)return;
  const el=document.createElement("span");
  el.className="bubble";
  el.style.cssText=`left:${x}px;top:${y}px;width:${size}px;height:${size}px`;
  document.body.appendChild(el);
  const anim=el.animate([
    {transform:"translate(-50%,-50%) scale(.3)",opacity:.95},
    {transform:`translate(calc(-50% + ${dx*.6}px),calc(-50% + ${dy*.6}px)) scale(1)`,opacity:.9,offset:.55},
    {transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(1.25)`,opacity:0}
  ],{duration,easing:"cubic-bezier(.2,.7,.3,1)"});
  anim.onfinish=()=>el.remove();
}

// ledakan gelembung ke segala arah
function burstBubbles(x,y,count=16,small=false){
  if(reduceMotion)return;
  for(let i=0;i<count;i++){
    const angle=rnd(0,Math.PI*2);
    const dist=small?rnd(30,75):rnd(55,140);
    spawnBubble(x,y,{
      size:small?rnd(6,16):rnd(8,28),
      dx:Math.cos(angle)*dist,
      dy:Math.sin(angle)*dist-18,
      duration:rnd(700,1200)
    });
  }
}

// confetti jatuh (dipakai saat pembayaran Lunas)
function confetti(x,y,count=40){
  if(reduceMotion)return;
  const colors=["#526b50","#d79a64","#e3b68a","#8fae8b","#f2d9b8","#344a35"];
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

// kartu paket dipilih / diklik
function onPackageClick(card,x,y){
  burstBubbles(x,y,20);
  if(isAdmin)return; // admin tidak memesan, cukup efek saja
  const p=packages.find(pk=>pk.id===card.dataset.id);if(!p)return;
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
  let last=0;
  document.querySelectorAll(".package-card").forEach(card=>{
    card.addEventListener("mousemove",e=>{
      const r=card.getBoundingClientRect();
      const px=(e.clientX-r.left)/r.width,py=(e.clientY-r.top)/r.height;
      card.style.setProperty("--mx",(px*100)+"%");
      card.style.setProperty("--my",(py*100)+"%");
      if(reduceMotion)return;
      card.style.transform=`perspective(700px) rotateX(${(.5-py)*8}deg) rotateY(${(px-.5)*8}deg) translateY(-4px)`;
      const now=performance.now();
      if(now-last>70){ // gelembung mengikuti kursor
        last=now;
        spawnBubble(e.clientX,e.clientY,{size:rnd(6,15),dx:rnd(-18,18),dy:-rnd(40,85),duration:rnd(900,1400)});
      }
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
  // gelembung melayang di background hero
  const wrap=document.createElement("div");wrap.className="hero-bubbles";
  for(let i=0;i<16;i++){
    const s=document.createElement("span"),size=rnd(10,46);
    s.style.cssText=`left:${rnd(0,100)}%;width:${size}px;height:${size}px;animation-duration:${rnd(9,18)}s;animation-delay:${-rnd(0,16)}s`;
    wrap.appendChild(s);
  }
  hero.prepend(wrap);
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

  // gelembung kecil saat klik tombol
  document.addEventListener("click",e=>{
    const b=e.target.closest(".btn,.nav-login,.table-action,.link-btn");
    if(!b)return;
    const r=b.getBoundingClientRect();
    const x=e.clientX||r.left+r.width/2,y=e.clientY||r.top+r.height/2;
    burstBubbles(x,y,8,true);
  });
}

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
  document.body.classList.toggle("is-admin",isAdmin);
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
    if(location.hash==="#admin"||location.hash==="#pesan")location.hash="#beranda";
  }
});

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
  const pkg=selectedPackage();if(!pkg){showToast("Pilih paket terlebih dahulu.");return}
  const tx={id:invoiceNumber(),name:$("customerName").value.trim(),contact:$("customerContact").value.trim(),packageId:pkg.id,packageName:pkg.name,price:pkg.price,date:$("serviceDate").value,notes:$("notes").value.trim(),createdAt:new Date().toISOString(),status:"Belum dibayar",method:"-",paidAt:null};
  localTx.set(tx.id,tx);
  setDoc(doc(db,"transaksi",tx.id),tx).catch(err=>{console.error(err);showToast("Gagal menyimpan ke database.")});
  openInvoice(tx.id,tx);$("bookingForm").reset();$("bookingPrice").textContent=money(0);syncSelectedCard();showToast("Pesanan berhasil dibuat. Invoice siap dilihat.");
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

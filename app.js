/* =====================================================================
   Omar Tareeq — admin.js
   Standalone admin site, gated by a single shared PIN (ADMIN_PIN below)
   instead of individual team accounts — change it to something private
   and don't publish this file's URL anywhere public.

   Under the hood, a real (hidden) Firebase account is still used so
   Firestore security rules can verify role == "admin" server-side —
   the PIN just controls whether the browser signs into that shared
   account. This file is a client-side gate, not a substitute for
   proper Firestore rules restricting writes to role == "admin".
   ===================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, getDocs, deleteDoc, updateDoc,
  query, where, orderBy, collection, serverTimestamp, addDoc, limit, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAC2RfglWsUWAY0knApyO8Enw7GvzjZbvg",
  authDomain: "omar-tareeq.firebaseapp.com",
  projectId: "omar-tareeq",
  storageBucket: "omar-tareeq.firebasestorage.app",
  messagingSenderId: "400428272159",
  appId: "1:400428272159:web:c236ea0b7e45f9bc46232a",
  measurementId: "G-ZZ1MLTMKX6"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

const ADMIN_PIN = "9033"; // change this to something only the team knows
const ADMIN_EMAIL = "team@omar-tareeq-admin.internal"; // hidden shared account, not a real inbox
const ADMIN_PASSWORD = "Ot-Team-9033-Shared-Key!"; // change this too — keep it private, same as the PIN
const GRADES = ["الأول الإعدادي","الثاني الإعدادي","الثالث الإعدادي","الأول الثانوي","الثاني الثانوي","الثالث الثانوي"];

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const show = (el) => el && el.classList.remove("hidden");
const hide = (el) => el && el.classList.add("hidden");
const escapeHtml = (str) => (str||"").toString().replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let toastTimer;
function toast(msg, type=""){
  const el = $("authMsg");
  el.textContent = msg;
  el.className = "auth-msg show " + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}
async function uploadFile(file, folder){
  const path = `${folder}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.\-_]/g,"")}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, file);
  return getDownloadURL(fileRef);
}
function confirmDialog(title, body){
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `<div class="modal-box">
      <h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p>
      <div class="modal-actions">
        <button class="chip-btn" id="cdCancel">إلغاء</button>
        <button class="chip-btn danger" id="cdOk">تأكيد</button>
      </div></div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector("#cdCancel").onclick = () => { backdrop.remove(); resolve(false); };
    backdrop.querySelector("#cdOk").onclick = () => { backdrop.remove(); resolve(true); };
  });
}
function gradeOptions(selected){
  return GRADES.map(g => `<option ${g===selected?"selected":""}>${g}</option>`).join("");
}
function wireCopyButtons(root){
  root.querySelectorAll("[data-copy]").forEach(b => b.addEventListener("click", () => {
    navigator.clipboard.writeText(b.dataset.copy);
    toast("تم نسخ الرابط", "success");
  }));
}
async function notifyUser(uid, title, body, link=""){
  try{
    await addDoc(collection(db,"notifications",uid,"items"), { title, body, link, read:false, createdAt: serverTimestamp() });
  }catch(err){ /* silent */ }
}
function writeErrorMessage(err){
  if (err?.code === "permission-denied"){
    return "الحفظ اترفض من قواعد أمان Firestore — لازم تسمح لـ role == admin بالكتابة على الكولكشن ده في Firestore Rules";
  }
  return "حصل خطأ أثناء الحفظ: " + (err?.message || "غير معروف");
}
document.addEventListener("contextmenu", (e) => {
  const tag = e.target.tagName;
  if (tag !== "INPUT" && tag !== "TEXTAREA") e.preventDefault();
});

/* ---------- PIN gate (signs into a hidden shared account behind the scenes) ---------- */
let provisioning = false;
let currentUserData = null;

async function enterAdminShell(uid){
  const userDoc = await getDoc(doc(db,"users",uid));
  if (!userDoc.exists() || userDoc.data().role !== "admin"){
    toast("حصل خطأ في الصلاحيات، حاول تاني", "error");
    await signOut(auth);
    return;
  }
  currentUserData = userDoc.data();
  hide($("auth-view")); show($("adminShell"));
  $("headerActions").classList.add("show");
  $("headerUserBox").textContent = currentUserData.fullName || "";
  initTabs();
}

$("pinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pin = $("pinInput").value.trim();
  if (pin !== ADMIN_PIN){ toast("الرمز غير صحيح", "error"); return; }
  $("pinInput").value = "";
  try{
    let cred;
    try{
      cred = await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
    }catch(err){
      if (err.code === "auth/user-not-found" || err.code === "auth/invalid-credential"){
        provisioning = true;
        cred = await createUserWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
        await setDoc(doc(db,"users",cred.user.uid), {
          fullName: "فريق Omar Tareeq", email: ADMIN_EMAIL, role: "admin", walletBalance: 0, createdAt: serverTimestamp()
        });
        provisioning = false;
      } else throw err;
    }
    await enterAdminShell(cred.user.uid);
  }catch(err){ toast("حصل خطأ أثناء الدخول، حاول تاني", "error"); }
});

/* ---------- session bootstrap ---------- */
onAuthStateChanged(auth, async (user) => {
  if (user){
    if (provisioning) return; // the pinForm handler above will call enterAdminShell itself once the profile write finishes
    await enterAdminShell(user.uid);
  } else {
    currentUserData = null;
    show($("auth-view")); hide($("adminShell"));
    $("headerActions").classList.remove("show");
    $("pinInput").value = "";
  }
});
$("logoutBtn").onclick = () => signOut(auth);

/* ---------- tabs ---------- */
let adminTab = "overview";
const TABS = ["overview","students","tracks","courses","lectures","tasks","exams","wallet","live"];
function tabLabel(t){
  return { overview:"نظرة عامة", students:"الطلاب", tracks:"المسارات", courses:"الكورسات", lectures:"المحاضرات", tasks:"المهام", exams:"اختبارات شاملة", wallet:"طلبات المحفظة", live:"البث المباشر" }[t];
}
function initTabs(){
  $("adminTabs").innerHTML = TABS.map(t => `<button class="tab-btn ${t===adminTab?"active":""}" data-tab="${t}">${tabLabel(t)}</button>`).join("");
  $("adminTabs").querySelectorAll(".tab-btn").forEach(b => b.addEventListener("click", () => {
    adminTab = b.dataset.tab;
    $("adminTabs").querySelectorAll(".tab-btn").forEach(x => x.classList.toggle("active", x===b));
    renderPane();
  }));
  renderPane();
}
function renderPane(){
  const pane = $("adminPane");
  const map = { overview:adminOverview, students:adminStudents, tracks:adminTracks, courses:adminCourses, lectures:adminLectures, tasks:adminTasks, exams:adminExams, wallet:adminWallet, live:adminLive };
  map[adminTab](pane);
}

/* ---- overview dashboard ---- */
function statCard(label, value){
  return `<div class="panel" style="text-align:center">
    <p class="small-note" style="margin:0 0 6px">${escapeHtml(label)}</p>
    <p style="font-family:var(--font-display);font-weight:700;font-size:24px;margin:0">${value}</p>
  </div>`;
}
async function adminOverview(pane){
  pane.innerHTML = `<div class="empty-state">جارِ التحميل</div>`;
  try{
    const [usersSnap, tracksSnap, coursesSnap, lecturesSnap, examsSnap, pendingSnap, liveSnap] = await Promise.all([
      getDocs(collection(db,"users")),
      getDocs(collection(db,"tracks")),
      getDocs(collection(db,"courses")),
      getDocs(collection(db,"lectures")),
      getDocs(collection(db,"comprehensiveExams")),
      getDocs(query(collection(db,"walletRequests"), where("status","==","pending"))),
      getDoc(doc(db,"liveStream","current"))
    ]);
    const students = usersSnap.docs.filter(d => d.data().role !== "admin");
    const admins = usersSnap.docs.filter(d => d.data().role === "admin");
    const totalWallet = students.reduce((sum,d) => sum + (d.data().walletBalance||0), 0);
    const paidCourses = coursesSnap.docs.filter(d => (d.data().price||0) > 0).length;
    const liveNow = liveSnap.exists() && liveSnap.data().isLive;

    pane.innerHTML = `
      <div class="card-grid" style="margin-bottom:16px">
        ${statCard("الطلاب", students.length)}
        ${statCard("أعضاء الفريق", admins.length)}
        ${statCard("المسارات", tracksSnap.size)}
        ${statCard("الكورسات", `${coursesSnap.size} (${paidCourses} مدفوع)`)}
        ${statCard("المحاضرات", lecturesSnap.size)}
        ${statCard("اختبارات شاملة", examsSnap.size)}
        ${statCard("طلبات شحن معلّقة", pendingSnap.size)}
        ${statCard("رصيد الطلاب الإجمالي", totalWallet + " ج.م")}
      </div>
      <div class="panel" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div><p style="font-family:var(--font-display);font-weight:700;margin:0 0 4px">حالة البث المباشر</p>
        <span class="badge ${liveNow?"approved":"pending"}">${liveNow?"شغّال دلوقتي":"مقفول"}</span></div>
        <button class="chip-btn" data-goto="live">فتح تبويب البث المباشر</button>
      </div>
      ${pendingSnap.size ? `<div class="panel" style="margin-top:14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <p style="font-family:var(--font-display);font-weight:700;margin:0">فيه ${pendingSnap.size} طلب شحن محتاج مراجعة</p>
        <button class="chip-btn" data-goto="wallet">مراجعة الطلبات</button>
      </div>` : ""}`;
    pane.querySelectorAll("[data-goto]").forEach(b => b.addEventListener("click", () => {
      adminTab = b.dataset.goto;
      initTabs();
    }));
  }catch(err){
    pane.innerHTML = `<div class="empty-state">${writeErrorMessage(err)}</div>`;
  }
}

/* ---------- students tab ---------- */
async function adminStudents(pane){
  pane.innerHTML = `
    <div class="students-search"><input id="studentSearch" placeholder="ابحث بالاسم أو الإيميل أو الهاتف أو اسم المستخدم" /></div>
    <div id="studentsList" class="row-list panel"><div class="empty-state">جارِ التحميل</div></div>`;
  const snap = await getDocs(collection(db,"users"));
  const all = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  renderStudentsList(all, all);
  $("studentSearch").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = !q ? all : all.filter(u =>
      (u.fullName||"").toLowerCase().includes(q) ||
      (u.email||"").toLowerCase().includes(q) ||
      (u.phone||"").includes(q) ||
      (u.username||"").toLowerCase().includes(q));
    renderStudentsList(filtered, all);
  });
}
function renderStudentsList(list, all){
  const box = $("studentsList");
  if (!list.length){ box.innerHTML = `<div class="empty-state">لا يوجد نتائج</div>`; return; }
  box.innerHTML = list.map(u => `
    <div class="row-item" style="align-items:flex-start;flex-wrap:wrap">
      <div class="row-main">
        <span class="row-title">${escapeHtml(u.fullName||"بدون اسم")} ${u.role==="admin"?'<span class="badge approved">فريق</span>':""}</span>
        <span class="row-sub">${escapeHtml(u.email||"")}${u.phone?" • "+escapeHtml(u.phone):""}${u.grade?" • "+escapeHtml(u.grade):""}</span>
        <span class="row-sub">رصيد المحفظة: ${u.walletBalance||0} ج.م</span>
      </div>
      <div class="row-actions">
        <button class="chip-btn" data-adjust="${u.id}">تعديل الرصيد</button>
        <button class="chip-btn ${u.role==="admin"?"danger":"success"}" data-role="${u.id}" data-current="${u.role||"student"}">${u.role==="admin"?"إزالة من الفريق":"ترقية للفريق"}</button>
      </div>
    </div>`).join("");

  box.querySelectorAll("[data-adjust]").forEach(b => b.addEventListener("click", async () => {
    const amountStr = prompt("قيمة التعديل بالجنيه (سالب للخصم، موجب للإضافة):", "0");
    const amount = Number(amountStr);
    if (!amountStr || Number.isNaN(amount) || amount === 0) return;
    try{
      await updateDoc(doc(db,"users",b.dataset.adjust), { walletBalance: increment(amount) });
      toast("تم تعديل الرصيد", "success");
      adminStudents($("adminPane"));
    }catch(err){ toast(writeErrorMessage(err), "error"); }
  }));
  box.querySelectorAll("[data-role]").forEach(b => b.addEventListener("click", async () => {
    const promote = b.dataset.current !== "admin";
    const ok = await confirmDialog(
      promote ? "ترقية للفريق" : "إزالة من الفريق",
      promote ? "هيقدر يدخل لوحة الإدارة ويعدّل كل حاجة. متأكد؟" : "هيفقد صلاحيات الإدارة فورًا. متأكد؟"
    );
    if (!ok) return;
    try{
      await updateDoc(doc(db,"users",b.dataset.role), { role: promote ? "admin" : "student" });
      toast("تم الحفظ", "success");
      adminStudents($("adminPane"));
    }catch(err){ toast(writeErrorMessage(err), "error"); }
  }));
}

/* ===================== reused CRUD sections ===================== */
async function adminTracks(pane){
  pane.innerHTML = `
    <div class="panel">
      <form id="trackForm" class="form-grid">
        <label class="field field-wide"><span>عنوان المسار</span><input id="tTitle" required /></label>
        <label class="field"><span>الصف</span><select id="tGrade" required><option value="" disabled selected>اختر</option>${gradeOptions()}</select></label>
        <label class="field"><span>الترتيب</span><input id="tOrder" type="number" value="1" required /></label>
        <label class="field field-wide"><span>وصف مختصر</span><textarea id="tDesc" rows="2"></textarea></label>
        <label class="field field-wide"><span>صورة المسار (اختياري)</span><input id="tImage" type="file" accept="image/*" /></label>
        <button type="submit" class="primary-btn field-wide">إضافة مسار</button>
      </form>
    </div>
    <div class="panel"><p style="font-weight:600;margin:0 0 10px">المسارات الحالية</p><div id="tracksAdminList" class="row-list"><div class="empty-state">جارِ التحميل</div></div></div>`;

  $("trackForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try{
      const file = $("tImage").files[0];
      const imageUrl = file ? await uploadFile(file, "trackImages") : "";
      await addDoc(collection(db,"tracks"), {
        title: $("tTitle").value.trim(), grade: $("tGrade").value, order: +$("tOrder").value,
        description: $("tDesc").value.trim(), imageUrl, coursesCount: 0, createdAt: serverTimestamp()
      });
      toast("تمت إضافة المسار", "success");
      e.target.reset();
      loadTracksAdminList();
    }catch(err){ toast(writeErrorMessage(err), "error"); }
  });
  loadTracksAdminList();
}
async function loadTracksAdminList(){
  const list = $("tracksAdminList");
  const snap = await getDocs(query(collection(db,"tracks"), orderBy("order","asc")));
  if (snap.empty){ list.innerHTML = `<div class="empty-state">لا توجد مسارات</div>`; return; }
  list.innerHTML = snap.docs.map(d => {
    const t = d.data();
    return `<div class="row-item"><div class="row-main"><span class="row-title">${escapeHtml(t.title)}</span><span class="row-sub">${escapeHtml(t.grade)}</span></div>
      <div class="row-actions"><button class="chip-btn danger" data-del="${d.id}">حذف</button></div></div>`;
  }).join("");
  list.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
    if (await confirmDialog("حذف المسار","هل أنت متأكد؟ الكورسات المرتبطة به لن تُحذف تلقائيًا.")){
      await deleteDoc(doc(db,"tracks",b.dataset.del));
      loadTracksAdminList();
    }
  }));
}

/* ---- admin: courses ---- */
async function adminCourses(pane){
  const tracksSnap = await getDocs(collection(db,"tracks"));
  const trackOptions = tracksSnap.docs.map(d => `<option value="${d.id}">${escapeHtml(d.data().title)}</option>`).join("");
  pane.innerHTML = `
    <div class="panel">
      <form id="courseForm" class="form-grid">
        <label class="field field-wide"><span>المسار</span><select id="cTrack" required><option value="" disabled selected>اختر مسار</option>${trackOptions}</select></label>
        <label class="field"><span>عنوان الكورس</span><input id="cTitle" required /></label>
        <label class="field"><span>الشهر</span><input id="cMonth" placeholder="مثال: أكتوبر" /></label>
        <label class="field"><span>الصف</span><select id="cGrade" required><option value="" disabled selected>اختر</option>${gradeOptions()}</select></label>
        <label class="field"><span>السعر (0 = مجاني)</span><input id="cPrice" type="number" value="0" min="0" required /></label>
        <label class="field field-wide"><span>صورة الكورس (اختياري)</span><input id="cImage" type="file" accept="image/*" /></label>
        <button type="submit" class="primary-btn field-wide">إضافة كورس</button>
      </form>
    </div>
    <div class="panel"><p style="font-weight:600;margin:0 0 10px">الكورسات الحالية</p><div id="coursesAdminList" class="row-list"><div class="empty-state">جارِ التحميل</div></div></div>`;

  $("courseForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try{
      const file = $("cImage").files[0];
      const imageUrl = file ? await uploadFile(file, "courseImages") : "";
      const trackId = $("cTrack").value;
      await addDoc(collection(db,"courses"), {
        trackId, title: $("cTitle").value.trim(), month: $("cMonth").value.trim(),
        grade: $("cGrade").value, price: +$("cPrice").value, imageUrl, createdAt: serverTimestamp()
      });
      await updateDoc(doc(db,"tracks",trackId), { coursesCount: increment(1) });
      toast("تمت إضافة الكورس", "success");
      e.target.reset();
      loadCoursesAdminList();
    }catch(err){ toast(writeErrorMessage(err), "error"); }
  });
  loadCoursesAdminList();
}
async function loadCoursesAdminList(){
  const list = $("coursesAdminList");
  const snap = await getDocs(collection(db,"courses"));
  if (snap.empty){ list.innerHTML = `<div class="empty-state">لا توجد كورسات</div>`; return; }
  list.innerHTML = snap.docs.map(d => {
    const c = d.data();
    return `<div class="row-item"><div class="row-main"><span class="row-title">${escapeHtml(c.title)}</span><span class="row-sub">${escapeHtml(c.grade)} • ${c.price>0?c.price+" ج.م":"مجاني"}</span></div>
      <div class="row-actions"><button class="chip-btn danger" data-del="${d.id}">حذف</button></div></div>`;
  }).join("");
  list.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
    if (await confirmDialog("حذف الكورس","هل أنت متأكد؟")){ await deleteDoc(doc(db,"courses",b.dataset.del)); loadCoursesAdminList(); }
  }));
}

/* ---- admin: lectures ---- */
async function adminLectures(pane){
  const coursesSnap = await getDocs(collection(db,"courses"));
  const courseOptions = coursesSnap.docs.map(d => `<option value="${d.id}">${escapeHtml(d.data().title)}</option>`).join("");
  pane.innerHTML = `
    <div class="panel">
      <form id="lectureForm" class="form-grid">
        <label class="field field-wide"><span>الكورس</span><select id="lCourse" required><option value="" disabled selected>اختر كورس</option>${courseOptions}</select></label>
        <label class="field"><span>عنوان المحاضرة</span><input id="lTitle" required /></label>
        <label class="field"><span>الترتيب</span><input id="lOrder" type="number" value="1" required /></label>
        <button type="submit" class="primary-btn field-wide">إضافة محاضرة</button>
      </form>
    </div>
    <div class="panel"><p style="font-weight:600;margin:0 0 10px">المحاضرات الحالية</p><div id="lecturesAdminList" class="row-list"><div class="empty-state">جارِ التحميل</div></div></div>`;

  $("lectureForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try{
      await addDoc(collection(db,"lectures"), {
        courseId: $("lCourse").value, title: $("lTitle").value.trim(), order: +$("lOrder").value, createdAt: serverTimestamp()
      });
      toast("تمت إضافة المحاضرة", "success");
      e.target.reset();
      loadLecturesAdminList();
    }catch(err){ toast(writeErrorMessage(err), "error"); }
  });
  loadLecturesAdminList();
}
async function loadLecturesAdminList(){
  const list = $("lecturesAdminList");
  const snap = await getDocs(query(collection(db,"lectures"), orderBy("order","asc")));
  if (snap.empty){ list.innerHTML = `<div class="empty-state">لا توجد محاضرات</div>`; return; }
  list.innerHTML = snap.docs.map(d => {
    const l = d.data();
    return `<div class="row-item"><div class="row-main"><span class="row-title">${escapeHtml(l.title)}</span></div>
      <div class="row-actions"><button class="chip-btn danger" data-del="${d.id}">حذف</button></div></div>`;
  }).join("");
  list.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
    if (await confirmDialog("حذف المحاضرة","هل أنت متأكد؟")){ await deleteDoc(doc(db,"lectures",b.dataset.del)); loadLecturesAdminList(); }
  }));
}

/* ---- admin: tasks ---- */
let taskBuilderQuestions = [];
async function adminTasks(pane){
  const lecturesSnap = await getDocs(collection(db,"lectures"));
  const lectureOptions = lecturesSnap.docs.map(d => `<option value="${d.id}">${escapeHtml(d.data().title)}</option>`).join("");
  pane.innerHTML = `
    <div class="panel">
      <form id="taskForm" class="form-grid">
        <label class="field field-wide"><span>المحاضرة</span><select id="taskLecture" required><option value="" disabled selected>اختر محاضرة</option>${lectureOptions}</select></label>
        <label class="field"><span>عنوان المهمة</span><input id="taskTitle" required /></label>
        <label class="field"><span>الترتيب</span><input id="taskOrder" type="number" value="1" required /></label>
        <label class="field field-wide"><span>نوع المهمة</span>
          <select id="taskType" required>
            <option value="video">فيديو</option><option value="pdf">ملف PDF</option>
            <option value="quiz">اختبار</option><option value="text">نص</option>
          </select>
        </label>
        <div class="field-wide" id="taskTypeFields"></div>
        <button type="submit" class="primary-btn field-wide">إضافة المهمة</button>
      </form>
    </div>
    <div class="panel"><p style="font-weight:600;margin:0 0 10px">المهام الحالية</p><div id="tasksAdminList" class="row-list"><div class="empty-state">جارِ التحميل</div></div></div>`;

  renderTaskTypeFields("video");
  $("taskType").addEventListener("change", (e) => renderTaskTypeFields(e.target.value));
  $("taskForm").addEventListener("submit", submitTaskForm);
  loadTasksAdminList();
}
function renderTaskTypeFields(type){
  const box = $("taskTypeFields");
  taskBuilderQuestions = [];
  if (type === "video"){
    box.innerHTML = `
      <label class="field"><span>مصدر الفيديو</span>
        <select id="videoSource"><option value="direct">رابط فيديو مباشر (.mp4)</option><option value="youtube">رابط يوتيوب</option></select>
      </label>
      <div id="videoSourceInput" style="margin-top:10px"></div>`;
    const sourceInput = $("videoSourceInput");
    function renderSourceInput(){
      sourceInput.innerHTML = $("videoSource").value === "direct"
        ? `<label class="field"><span>رابط الفيديو (لازم ينتهي بـ .mp4 — مثال: من كاتبوكس)</span><input id="videoUrl" type="url" inputmode="url" placeholder="https://files.catbox.moe/xxxxx.mp4" required /></label>`
        : `<label class="field"><span>رابط يوتيوب</span><input id="videoUrl" type="url" inputmode="url" placeholder="https://youtube.com/watch?v=..." required /></label>`;
    }
    $("videoSource").addEventListener("change", renderSourceInput);
    renderSourceInput();
  } else if (type === "pdf"){
    box.innerHTML = `<label class="field"><span>رابط ملف PDF (لازم ينتهي بـ .pdf — مثال: من كاتبوكس)</span><input id="pdfUrl" type="url" inputmode="url" placeholder="https://files.catbox.moe/xxxxx.pdf" required /></label>`;
  } else if (type === "quiz"){
    box.innerHTML = `<div id="quizBuilder"></div><button type="button" class="chip-btn" id="addQuestionBtn">+ إضافة سؤال</button>`;
    $("addQuestionBtn").onclick = () => { taskBuilderQuestions.push(blankQuestion()); renderQuestionBuilder(); };
    renderQuestionBuilder();
  } else if (type === "text"){
    box.innerHTML = `<div id="segmentBuilder"></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button type="button" class="chip-btn" id="addTextSegBtn">+ جملة</button>
        <button type="button" class="chip-btn" id="addBtnSegBtn">+ زر برابط</button>
      </div>`;
    window.textSegments = [];
    $("addTextSegBtn").onclick = () => { window.textSegments.push({ type:"text", text:"", color:"#1d1d1f" }); renderSegmentBuilder(); };
    $("addBtnSegBtn").onclick = () => { window.textSegments.push({ type:"button", label:"", url:"" }); renderSegmentBuilder(); };
    renderSegmentBuilder();
  }
}
function blankQuestion(){ return { text:"", imageFile:null, options:[{text:"",imageFile:null},{text:"",imageFile:null}], correctIndex:0 }; }
function renderQuestionBuilder(){
  const box = $("quizBuilder");
  box.innerHTML = taskBuilderQuestions.map((q,qi) => `
    <div class="panel" style="margin-bottom:10px">
      <p class="small-note">سؤال ${qi+1}</p>
      <textarea data-qtext="${qi}" placeholder="نص السؤال" rows="2" style="width:100%">${escapeHtml(q.text)}</textarea>
      <label class="small-note" style="display:block;margin-top:6px">صورة السؤال (اختياري)<input type="file" accept="image/*" data-qimg="${qi}" /></label>
      <div style="margin-top:10px">
        ${q.options.map((o,oi) => `
          <div class="option-row" style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <input type="radio" name="correct${qi}" data-correct="${qi}:${oi}" ${q.correctIndex===oi?"checked":""} />
            <input type="text" placeholder="نص الاختيار ${oi+1}" data-otext="${qi}:${oi}" value="${escapeHtml(o.text)}" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:8px" />
            <input type="file" accept="image/*" data-oimg="${qi}:${oi}" style="width:120px" />
          </div>`).join("")}
      </div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button type="button" class="chip-btn" data-addopt="${qi}">+ اختيار</button>
        <button type="button" class="chip-btn danger" data-delq="${qi}">حذف السؤال</button>
      </div>
    </div>`).join("");

  box.querySelectorAll("[data-qtext]").forEach(t => t.addEventListener("input", e => taskBuilderQuestions[+e.target.dataset.qtext].text = e.target.value));
  box.querySelectorAll("[data-qimg]").forEach(t => t.addEventListener("change", e => taskBuilderQuestions[+e.target.dataset.qimg].imageFile = e.target.files[0]));
  box.querySelectorAll("[data-otext]").forEach(t => t.addEventListener("input", e => {
    const [qi,oi] = e.target.dataset.otext.split(":").map(Number);
    taskBuilderQuestions[qi].options[oi].text = e.target.value;
  }));
  box.querySelectorAll("[data-oimg]").forEach(t => t.addEventListener("change", e => {
    const [qi,oi] = e.target.dataset.oimg.split(":").map(Number);
    taskBuilderQuestions[qi].options[oi].imageFile = e.target.files[0];
  }));
  box.querySelectorAll("[data-correct]").forEach(t => t.addEventListener("change", e => {
    const [qi,oi] = e.target.dataset.correct.split(":").map(Number);
    taskBuilderQuestions[qi].correctIndex = oi;
  }));
  box.querySelectorAll("[data-addopt]").forEach(t => t.addEventListener("click", e => {
    taskBuilderQuestions[+e.target.dataset.addopt].options.push({ text:"", imageFile:null });
    renderQuestionBuilder();
  }));
  box.querySelectorAll("[data-delq]").forEach(t => t.addEventListener("click", e => {
    taskBuilderQuestions.splice(+e.target.dataset.delq,1);
    renderQuestionBuilder();
  }));
}
function renderSegmentBuilder(){
  const box = $("segmentBuilder");
  box.innerHTML = window.textSegments.map((s,i) => s.type === "text" ? `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <input type="color" data-segcolor="${i}" value="${s.color}" />
      <input type="text" data-segtext="${i}" value="${escapeHtml(s.text)}" placeholder="نص" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:8px" />
      <button type="button" class="chip-btn danger" data-delseg="${i}">حذف</button>
    </div>` : `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <input type="text" data-seglabel="${i}" value="${escapeHtml(s.label)}" placeholder="نص الزر" style="border:1px solid var(--line);border-radius:8px;padding:8px" />
      <input type="url" data-segurl="${i}" value="${escapeHtml(s.url)}" placeholder="الرابط" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:8px" />
      <button type="button" class="chip-btn danger" data-delseg="${i}">حذف</button>
    </div>`).join("");
  box.querySelectorAll("[data-segtext]").forEach(t => t.addEventListener("input", e => window.textSegments[+e.target.dataset.segtext].text = e.target.value));
  box.querySelectorAll("[data-segcolor]").forEach(t => t.addEventListener("input", e => window.textSegments[+e.target.dataset.segcolor].color = e.target.value));
  box.querySelectorAll("[data-seglabel]").forEach(t => t.addEventListener("input", e => window.textSegments[+e.target.dataset.seglabel].label = e.target.value));
  box.querySelectorAll("[data-segurl]").forEach(t => t.addEventListener("input", e => window.textSegments[+e.target.dataset.segurl].url = e.target.value));
  box.querySelectorAll("[data-delseg]").forEach(t => t.addEventListener("click", e => { window.textSegments.splice(+e.target.dataset.delseg,1); renderSegmentBuilder(); }));
}

async function submitTaskForm(e){
  e.preventDefault();
  const lectureId = $("taskLecture").value;
  const title = $("taskTitle").value.trim();
  const order = +$("taskOrder").value;
  const type = $("taskType").value;
  const base = { lectureId, title, order, type, createdAt: serverTimestamp() };

  try{
    if (type === "video"){
      const source = $("videoSource").value;
      const url = $("videoUrl").value.trim();
      if (source === "direct"){
        if (!/\.mp4($|\?)/i.test(url)){ toast("الرابط لازم ينتهي بـ .mp4", "error"); return; }
        base.videoSource = "direct";
        base.videoUrl = url;
      } else {
        if (!url){ toast("أدخل رابط اليوتيوب", "error"); return; }
        base.videoSource = "youtube";
        base.videoUrl = url;
      }
    } else if (type === "pdf"){
      const url = $("pdfUrl").value.trim();
      if (!/\.pdf($|\?)/i.test(url)){ toast("الرابط لازم ينتهي بـ .pdf", "error"); return; }
      base.pdfUrl = url;
    } else if (type === "quiz"){
      if (!taskBuilderQuestions.length){ toast("أضف سؤالًا واحدًا على الأقل", "error"); return; }
      base.questions = await Promise.all(taskBuilderQuestions.map(async q => ({
        text: q.text,
        imageUrl: q.imageFile ? await uploadFile(q.imageFile, "quizImages") : "",
        correctIndex: q.correctIndex,
        options: await Promise.all(q.options.map(async o => ({
          text: o.text, imageUrl: o.imageFile ? await uploadFile(o.imageFile, "quizImages") : ""
        })))
      })));
    } else if (type === "text"){
      base.segments = window.textSegments || [];
    }
    await addDoc(collection(db,"tasks"), base);
    toast("تمت إضافة المهمة", "success");
    e.target.reset();
    renderTaskTypeFields("video");
    $("taskType").value = "video";
    loadTasksAdminList();
  }catch(err){
    toast("حصل خطأ أثناء إضافة المهمة", "error");
  }
}
async function loadTasksAdminList(){
  const list = $("tasksAdminList");
  const snap = await getDocs(query(collection(db,"tasks"), orderBy("order","asc")));
  if (snap.empty){ list.innerHTML = `<div class="empty-state">لا توجد مهام</div>`; return; }
  const typeLabel = { video:"فيديو", pdf:"PDF", quiz:"اختبار", text:"نص" };
  list.innerHTML = snap.docs.map(d => {
    const t = d.data();
    return `<div class="row-item"><div class="row-main"><span class="row-title">${escapeHtml(t.title)}</span><span class="row-sub">${typeLabel[t.type]||""}</span></div>
      <div class="row-actions"><button class="chip-btn danger" data-del="${d.id}">حذف</button></div></div>`;
  }).join("");
  list.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
    if (await confirmDialog("حذف المهمة","هل أنت متأكد؟")){ await deleteDoc(doc(db,"tasks",b.dataset.del)); loadTasksAdminList(); }
  }));
}

/* ---- admin: comprehensive exams ---- */
let examBuilderQuestions = [];
async function adminExams(pane){
  pane.innerHTML = `
    <div class="panel">
      <form id="examForm" class="form-grid">
        <label class="field field-wide"><span>عنوان الاختبار</span><input id="eTitle" required /></label>
        <label class="field"><span>الصف</span><select id="eGrade" required><option value="" disabled selected>اختر</option>${gradeOptions()}</select></label>
        <label class="field"><span>مدة الاختبار (دقيقة)</span><input id="eDuration" type="number" value="30" required /></label>
        <label class="field"><span>وقت البداية</span><input id="eStart" type="datetime-local" required /></label>
        <label class="field"><span>وقت النهاية</span><input id="eEnd" type="datetime-local" required /></label>
        <div class="field-wide" id="examQuizBuilder"></div>
        <button type="button" class="chip-btn field-wide" id="addExamQBtn" style="justify-self:start">+ إضافة سؤال</button>
        <button type="submit" class="primary-btn field-wide">إنشاء الاختبار</button>
      </form>
    </div>
    <div class="panel"><p style="font-weight:600;margin:0 0 10px">الاختبارات الحالية</p><div id="examsAdminList" class="row-list"><div class="empty-state">جارِ التحميل</div></div></div>`;

  examBuilderQuestions = [];
  window.__examBuilderTarget = "examQuizBuilder";
  renderExamQuestionBuilder();
  $("addExamQBtn").onclick = () => { examBuilderQuestions.push(blankQuestion()); renderExamQuestionBuilder(); };
  $("examForm").addEventListener("submit", submitExamForm);
  loadExamsAdminList();
}
function renderExamQuestionBuilder(){
  const box = $("examQuizBuilder");
  box.innerHTML = examBuilderQuestions.map((q,qi) => `
    <div class="panel" style="margin-bottom:10px">
      <p class="small-note">سؤال ${qi+1}</p>
      <textarea data-eqtext="${qi}" placeholder="نص السؤال" rows="2" style="width:100%">${escapeHtml(q.text)}</textarea>
      <label class="small-note" style="display:block;margin-top:6px">صورة السؤال (اختياري)<input type="file" accept="image/*" data-eqimg="${qi}" /></label>
      <div style="margin-top:10px">
        ${q.options.map((o,oi) => `
          <div class="option-row" style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <input type="radio" name="ecorrect${qi}" data-ecorrect="${qi}:${oi}" ${q.correctIndex===oi?"checked":""} />
            <input type="text" placeholder="نص الاختيار ${oi+1}" data-eotext="${qi}:${oi}" value="${escapeHtml(o.text)}" style="flex:1;border:1px solid var(--line);border-radius:8px;padding:8px" />
          </div>`).join("")}
      </div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button type="button" class="chip-btn" data-eaddopt="${qi}">+ اختيار</button>
        <button type="button" class="chip-btn danger" data-edelq="${qi}">حذف السؤال</button>
      </div>
    </div>`).join("");
  box.querySelectorAll("[data-eqtext]").forEach(t => t.addEventListener("input", e => examBuilderQuestions[+e.target.dataset.eqtext].text = e.target.value));
  box.querySelectorAll("[data-eqimg]").forEach(t => t.addEventListener("change", e => examBuilderQuestions[+e.target.dataset.eqimg].imageFile = e.target.files[0]));
  box.querySelectorAll("[data-eotext]").forEach(t => t.addEventListener("input", e => {
    const [qi,oi] = e.target.dataset.eotext.split(":").map(Number); examBuilderQuestions[qi].options[oi].text = e.target.value;
  }));
  box.querySelectorAll("[data-ecorrect]").forEach(t => t.addEventListener("change", e => {
    const [qi,oi] = e.target.dataset.ecorrect.split(":").map(Number); examBuilderQuestions[qi].correctIndex = oi;
  }));
  box.querySelectorAll("[data-eaddopt]").forEach(t => t.addEventListener("click", e => {
    examBuilderQuestions[+e.target.dataset.eaddopt].options.push({ text:"", imageFile:null }); renderExamQuestionBuilder();
  }));
  box.querySelectorAll("[data-edelq]").forEach(t => t.addEventListener("click", e => {
    examBuilderQuestions.splice(+e.target.dataset.edelq,1); renderExamQuestionBuilder();
  }));
}
async function submitExamForm(e){
  e.preventDefault();
  if (!examBuilderQuestions.length){ toast("أضف سؤالًا واحدًا على الأقل", "error"); return; }
  try{
    const questions = await Promise.all(examBuilderQuestions.map(async q => ({
      text: q.text, imageUrl: q.imageFile ? await uploadFile(q.imageFile, "examImages") : "",
      correctIndex: q.correctIndex,
      options: q.options.map(o => ({ text: o.text, imageUrl: "" }))
    })));
    await addDoc(collection(db,"comprehensiveExams"), {
      title: $("eTitle").value.trim(), grade: $("eGrade").value, durationMinutes: +$("eDuration").value,
      startTime: new Date($("eStart").value).toISOString(), endTime: new Date($("eEnd").value).toISOString(),
      questions, createdAt: serverTimestamp()
    });
    toast("تم إنشاء الاختبار", "success");
    e.target.reset();
    examBuilderQuestions = [];
    renderExamQuestionBuilder();
    loadExamsAdminList();
  }catch(err){ toast("حصل خطأ أثناء إنشاء الاختبار", "error"); }
}
async function loadExamsAdminList(){
  const list = $("examsAdminList");
  const snap = await getDocs(collection(db,"comprehensiveExams"));
  if (snap.empty){ list.innerHTML = `<div class="empty-state">لا توجد اختبارات</div>`; return; }
  list.innerHTML = snap.docs.map(d => {
    const ex = d.data();
    const url = `${location.origin}${location.pathname}#/exam/${d.id}`;
    return `<div class="row-item"><div class="row-main"><span class="row-title">${escapeHtml(ex.title)}</span><span class="row-sub">${escapeHtml(ex.grade)}</span></div>
      <div class="row-actions"><button class="chip-btn" data-copy="${url}">نسخ الرابط</button><button class="chip-btn danger" data-del="${d.id}">حذف</button></div></div>`;
  }).join("");
  wireCopyButtons(list);
  list.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
    if (await confirmDialog("حذف الاختبار","هل أنت متأكد؟")){ await deleteDoc(doc(db,"comprehensiveExams",b.dataset.del)); loadExamsAdminList(); }
  }));
}

/* ---- admin: wallet requests ---- */
async function adminWallet(pane){
  pane.innerHTML = `<div id="walletAdminList" class="row-list panel"><div class="empty-state">جارِ التحميل</div></div>`;
  const list = $("walletAdminList");
  const snap = await getDocs(query(collection(db,"walletRequests"), where("status","==","pending")));
  if (snap.empty){ list.innerHTML = `<div class="empty-state">لا توجد طلبات معلّقة</div>`; return; }
  list.innerHTML = snap.docs.map(d => {
    const r = d.data();
    return `<div class="row-item" style="align-items:flex-start;flex-wrap:wrap">
      <div class="row-main"><span class="row-title">${escapeHtml(r.userName)}</span>
        <a href="${r.proofUrl}" target="_blank" rel="noopener" class="row-sub">عرض صورة التحويل</a></div>
      <div class="row-actions">
        <input type="number" placeholder="المبلغ" data-amount="${d.id}" style="width:90px;border:1px solid var(--line);border-radius:8px;padding:7px" />
        <button class="chip-btn success" data-approve="${d.id}" data-uid="${r.userId}">قبول</button>
        <button class="chip-btn danger" data-reject="${d.id}" data-uid="${r.userId}">رفض</button>
      </div>
    </div>`;
  }).join("");
  list.querySelectorAll("[data-approve]").forEach(b => b.addEventListener("click", async () => {
    const amount = +document.querySelector(`[data-amount="${b.dataset.approve}"]`).value;
    if (!amount || amount <= 0){ toast("أدخل المبلغ أولًا", "error"); return; }
    try{
      await updateDoc(doc(db,"users",b.dataset.uid), { walletBalance: increment(amount) });
      await updateDoc(doc(db,"walletRequests",b.dataset.approve), { status:"approved", amount, reviewedAt: serverTimestamp() });
      await notifyUser(b.dataset.uid, "تم شحن المحفظة", `تم إضافة ${amount} ج.م لرصيدك`, "");
      toast("تم القبول", "success");
      adminWallet(pane);
    }catch(err){ toast(writeErrorMessage(err), "error"); }
  }));
  list.querySelectorAll("[data-reject]").forEach(b => b.addEventListener("click", async () => {
    try{
      await updateDoc(doc(db,"walletRequests",b.dataset.reject), { status:"rejected", reviewedAt: serverTimestamp() });
      await notifyUser(b.dataset.uid, "تم رفض طلب الشحن", "من فضلك تأكد من صورة التحويل وأعد المحاولة", "");
      toast("تم الرفض", "success");
      adminWallet(pane);
    }catch(err){ toast(writeErrorMessage(err), "error"); }
  }));
}

/* ---- admin: live stream ---- */
async function adminLive(pane){
  const snap = await getDoc(doc(db,"liveStream","current"));
  const data = snap.exists() ? snap.data() : { youtubeUrl:"", isLive:false };
  pane.innerHTML = `
    <div class="panel">
      <label class="field"><span>رابط بث اليوتيوب</span><input id="liveUrl" value="${escapeHtml(data.youtubeUrl||"")}" placeholder="https://youtube.com/watch?v=..." /></label>
      <label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:14px">
        <input type="checkbox" id="liveToggle" ${data.isLive?"checked":""} /> البث شغّال الآن
      </label>
      <button class="primary-btn" id="saveLiveBtn" style="width:auto;padding:11px 26px;margin-top:16px">حفظ</button>
    </div>`;
  $("saveLiveBtn").onclick = async () => {
    try{
      await setDoc(doc(db,"liveStream","current"), {
        youtubeUrl: $("liveUrl").value.trim(), isLive: $("liveToggle").checked, updatedAt: serverTimestamp()
      });
      toast("تم الحفظ", "success");
    }catch(err){ toast(writeErrorMessage(err), "error"); }
  };
}

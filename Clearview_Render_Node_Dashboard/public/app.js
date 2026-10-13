const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let currentUser = null;
let toastTimer;

$("#year").textContent = new Date().getFullYear();
$("#todayDate").textContent = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed. Please try again.");
  return data;
}
function showAlert(message) {
  const el = $("#formAlert");
  el.textContent = message;
  el.hidden = false;
}
function clearAlert() { $("#formAlert").hidden = true; $("#formAlert").textContent = ""; }
function setBusy(form, busy) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = busy;
  button.dataset.originalText ||= button.querySelector("span").textContent;
  button.querySelector("span").textContent = busy ? "Please wait…" : button.dataset.originalText;
}
function setAuthMode(mode) {
  clearAlert();
  const registering = mode === "register";
  $("#loginForm").hidden = registering;
  $("#registerForm").hidden = !registering;
  $("#formEyebrow").textContent = registering ? "GET STARTED" : "WELCOME BACK";
  $("#formTitle").textContent = registering ? "Create your account" : "Sign in to your space";
  $("#formSubtitle").textContent = registering ? "Set up your personal workspace in seconds." : "Pick up right where you left off.";
  $("#authSwitch").innerHTML = registering
    ? 'Already have an account? <button type="button" class="text-btn" id="showLogin">Sign in</button>'
    : 'New to Clearview? <button type="button" class="text-btn" id="showRegister">Create an account</button>';
  $("#showRegister")?.addEventListener("click", () => setAuthMode("register"));
  $("#showLogin")?.addEventListener("click", () => setAuthMode("login"));
}
function initials(name) {
  return (name || "U").trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}
function showApp(user) {
  currentUser = user;
  $("#authShell").hidden = true;
  $("#appShell").hidden = false;
  $("#sidebarName").textContent = user.displayName;
  $("#sidebarEmail").textContent = user.email;
  $("#sidebarAvatar").textContent = initials(user.displayName);
  $("#topAvatar").textContent = initials(user.displayName);
  $("#welcomeName").textContent = user.displayName.split(/\s+/)[0];
  $("#settingsEmail").textContent = user.email;
  loadDashboard();
}
function showAuth() {
  currentUser = null;
  $("#appShell").hidden = true;
  $("#authShell").hidden = false;
  setAuthMode("login");
}
async function handleAuth(form, endpoint) {
  clearAlert();
  setBusy(form, true);
  const payload = Object.fromEntries(new FormData(form).entries());
  try {
    const data = await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
    form.reset();
    showApp(data.user);
  } catch (error) {
    showAlert(error.message);
  } finally {
    setBusy(form, false);
  }
}
$("#loginForm").addEventListener("submit", event => {
  event.preventDefault();
  handleAuth(event.currentTarget, "/api/login");
});
$("#registerForm").addEventListener("submit", event => {
  event.preventDefault();
  handleAuth(event.currentTarget, "/api/register");
});
$("#showRegister").addEventListener("click", () => setAuthMode("register"));

function goTo(page) {
  $$(".page").forEach(el => el.classList.toggle("active-page", el.id === `page-${page}`));
  $$(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.page === page));
  const label = page.charAt(0).toUpperCase() + page.slice(1);
  $("#breadcrumbPage").textContent = label;
  $("#sidebar").classList.remove("open");
  if (page === "activity") loadActivity();
  if (page === "settings") loadSettings();
}
$$(".nav-item").forEach(button => button.addEventListener("click", () => goTo(button.dataset.page)));
$$("[data-go]").forEach(button => button.addEventListener("click", () => goTo(button.dataset.go)));
$("#mobileMenu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
$("#topAvatar").addEventListener("click", () => goTo("settings"));
$("#sidebarUser").addEventListener("click", () => goTo("settings"));
$("#logoutSettings").addEventListener("click", logout);

async function logout() {
  try { await api("/api/logout", { method: "POST", body: "{}" }); }
  catch (error) { showToast(error.message); return; }
  showAuth();
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
function activityMarkup(items) {
  const symbols = ["✦", "✓", "▦"];
  return items.map((item, index) => `
    <div class="activity-item">
      <span class="activity-symbol">${symbols[index % symbols.length]}</span>
      <div class="activity-text"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div>
      <span class="activity-time">${escapeHtml(item.time)}</span>
    </div>`).join("");
}
async function loadDashboard() {
  try {
    const data = await api("/api/dashboard");
    const icons = ["◉", "◷", "✓"];
    const colors = ["purple", "blue", "green"];
    $("#statsGrid").innerHTML = data.stats.map((stat, i) => `
      <article class="stat-card"><div class="stat-top"><span class="stat-label">${escapeHtml(stat.label)}</span><span class="stat-icon ${colors[i]}">${icons[i]}</span></div>
      <div class="stat-value">${escapeHtml(stat.value)}</div><div class="stat-detail">${escapeHtml(stat.detail)}</div></article>`).join("");
    $("#overviewActivity").innerHTML = activityMarkup(data.activity.slice(0, 3));
    $("#allActivity").innerHTML = activityMarkup(data.activity);
  } catch (error) {
    if (error.message.toLowerCase().includes("sign in")) showAuth();
    else showToast(error.message);
  }
}
async function loadActivity() {
  try {
    const data = await api("/api/dashboard");
    $("#allActivity").innerHTML = activityMarkup(data.activity);
  } catch (error) { showToast(error.message); }
}
async function loadSettings() {
  try {
    const data = await api("/api/settings");
    $("#emailNotifications").checked = data.preferences.emailNotifications !== false;
    $("#compactMode").checked = data.preferences.compactMode === true;
    document.body.classList.toggle("compact-mode", $("#compactMode").checked);
  } catch (error) { showToast(error.message); }
}
$("#settingsForm").addEventListener("submit", async event => {
  event.preventDefault();
  const message = $("#settingsMessage");
  message.textContent = "Saving…";
  try {
    const data = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        emailNotifications: $("#emailNotifications").checked,
        compactMode: $("#compactMode").checked
      })
    });
    document.body.classList.toggle("compact-mode", data.preferences.compactMode);
    message.textContent = "Saved successfully.";
    showToast("Your preferences have been saved.");
  } catch (error) {
    message.textContent = error.message;
  }
});
$("#compactMode").addEventListener("change", () => {
  document.body.classList.toggle("compact-mode", $("#compactMode").checked);
});
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

(async function boot() {
  try {
    const data = await api("/api/me");
    if (data.user) showApp(data.user);
    else showAuth();
  } catch {
    showAuth();
  }
})();

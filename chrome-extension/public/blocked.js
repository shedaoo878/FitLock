const checkBtn = document.getElementById("check-btn");
const goalSection = document.getElementById("goal-section");
const goalText = document.getElementById("goal-text");
const progressFill = document.getElementById("progress-fill");
const todaySection = document.getElementById("today-section");
const weekSection = document.getElementById("week-section");
const notConnected = document.getElementById("not-connected");
const loading = document.getElementById("loading");
const hint = document.getElementById("hint");

function formatDuration(totalSec) {
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function displayStats(data) {
  loading.classList.add("hidden");
  checkBtn.classList.remove("hidden");
  hint.classList.remove("hidden");

  // Goal progress
  goalSection.classList.remove("hidden");
  const pct = Math.min((data.today.miles / data.goalMiles) * 100, 100);
  goalText.textContent = `${data.today.miles.toFixed(2)} / ${data.goalMiles} miles`;
  progressFill.style.width = `${pct}%`;

  if (data.goalMet) {
    goalText.textContent += " — Goal met! Unlocking...";
    hint.classList.add("hidden");
    setTimeout(() => window.history.back(), 1500);
    return;
  }

  // Today
  todaySection.classList.remove("hidden");
  document.getElementById("today-miles").textContent = data.today.miles.toFixed(2);
  document.getElementById("today-runs").textContent = data.today.runs;
  document.getElementById("today-time").textContent =
    data.today.durationSec > 0 ? formatDuration(data.today.durationSec) : "0m";

  // Week
  weekSection.classList.remove("hidden");
  document.getElementById("week-miles").textContent = data.week.miles.toFixed(2);
  document.getElementById("week-runs").textContent = data.week.runs;
  document.getElementById("week-time").textContent =
    data.week.durationSec > 0 ? formatDuration(data.week.durationSec) : "0m";
}

function fetchAndDisplay() {
  checkBtn.disabled = true;
  checkBtn.textContent = "Checking...";

  chrome.runtime.sendMessage({ action: "checkGoal" }, (res) => {
    checkBtn.textContent = "Refresh";
    checkBtn.disabled = false;

    if (res.success) {
      displayStats(res);
    } else if (res.error && res.error.includes("Not connected")) {
      loading.classList.add("hidden");
      notConnected.classList.remove("hidden");
      checkBtn.classList.remove("hidden");
    } else {
      loading.classList.add("hidden");
      checkBtn.classList.remove("hidden");
      goalSection.classList.remove("hidden");
      goalText.textContent = res.error || "Failed to check progress.";
    }
  });
}

checkBtn.addEventListener("click", fetchAndDisplay);

// Auto-fetch on page load
chrome.runtime.sendMessage({ action: "getStatus" }, (res) => {
  if (!res.stravaConnected) {
    loading.classList.add("hidden");
    notConnected.classList.remove("hidden");
    checkBtn.classList.remove("hidden");
    return;
  }
  // Immediately fetch fresh data from Strava
  fetchAndDisplay();
});

// ── Custom Cursor ──
const cursor = document.getElementById("custom-cursor");
const interactiveSelectors = "a, button, [role='button'], input, select, textarea";

document.addEventListener("mousemove", (e) => {
  cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
});

document.addEventListener("mouseover", (e) => {
  if (e.target.closest(interactiveSelectors)) {
    cursor.classList.add("hovering");
  }
});

document.addEventListener("mouseout", (e) => {
  if (e.target.closest(interactiveSelectors)) {
    cursor.classList.remove("hovering");
  }
});

document.addEventListener("mouseleave", () => {
  cursor.style.display = "none";
});

document.addEventListener("mouseenter", () => {
  cursor.style.display = "";
});

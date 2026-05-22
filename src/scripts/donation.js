const form = document.getElementById("donation-form");
const presets = Array.from(document.querySelectorAll(".preset"));
const otherAmountInput = document.getElementById("otherAmount");
const statusEl = document.getElementById("form-status");
const submitBtn = form.querySelector('button[type="submit"]');
const pingBtn = document.getElementById("ping");
const PUBLIC_API_URL = import.meta.env.PUBLIC_API_URL;

pingBtn.addEventListener("click", async () => {
  console.log("Pinging server at:", PUBLIC_API_URL);
  try {
    const response = await fetch(`${PUBLIC_API_URL}/api/ping`);
    const data = await response.json();
    alert(`Ping response: ${data.message}`);
  } catch (error) {
    alert("Error pinging server: " + error.message);
  }
});

function setActivePreset(btn) {
  presets.forEach((p) => p.classList.remove("active"));
  if (btn) btn.classList.add("active");
  otherAmountInput.value = "";
}

presets.forEach((p) => p.addEventListener("click", () => setActivePreset(p)));

form.addEventListener("submit", (e) => {
  e.preventDefault();
  statusEl.textContent = "";
  const originalBtnText = submitBtn ? submitBtn.textContent : "Donate";

  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());

  let amount =
    data.otherAmount && Number(data.otherAmount) > 0
      ? Number(data.otherAmount)
      : null;
  if (!amount) {
    const active =
      presets.find((p) => p.classList.contains("active")) || presets[0];
    amount = Number(active?.dataset.amount || 0);
  }

  if (!data.name || !data.email || !data.phone) {
    statusEl.textContent = "Please fill required fields (Name, Email, Phone).";
    return;
  }

  const payload = {
    name: data.name,
    email: data.email,
    phone: data.phone,
    address: data.address || "",
    pan: data.pan || "",
    nationality: data.nationality || "",
    amount: amount,
    timestamp: new Date().toISOString(),
  };

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Logging...";
    submitBtn.setAttribute("aria-disabled", "true");
  }

  console.log("Donation payload:", payload);
  statusEl.textContent = "Donation data logged to the console.";
  form.reset();
  setActivePreset(presets[0]);

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = originalBtnText;
    submitBtn.removeAttribute("aria-disabled");
  }
});

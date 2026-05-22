const form = document.getElementById("donation-form");
const presets = Array.from(document.querySelectorAll(".preset"));
const otherAmountInput = document.getElementById("otherAmount");
const statusEl = document.getElementById("form-status");
const submitBtn = form.querySelector('button[type="submit"]');
const pingBtn = document.getElementById("ping");
const PUBLIC_API_URL = import.meta.env.PUBLIC_API_URL;

// Check for payment status in URL parameters
const urlParams = new URLSearchParams(window.location.search);
const paymentStatus = urlParams.get("status");
const orderId = urlParams.get("orderId");

if (paymentStatus) {
  if (paymentStatus === "TXN_SUCCESS") {
    statusEl.textContent = `Payment successful! Order ID: ${orderId}. Thank you for your donation.`;
    statusEl.style.color = "green";
  } else {
    statusEl.textContent = `Payment ${paymentStatus}. Please try again or contact support if the issue persists.`;
    statusEl.style.color = "red";
  }
  // Clear URL parameters
  window.history.replaceState({}, document.title, window.location.pathname);
}

// pingBtn.addEventListener("click", async () => {
//   console.log("Pinging server at:", PUBLIC_API_URL);
//   try {
//     const response = await fetch(`${PUBLIC_API_URL}/api/ping`);
//     const data = await response.json();
//     alert(`Ping response: ${data.message}`);
//   } catch (error) {
//     alert("Error pinging server: " + error.message);
//   }
// });

function setActivePreset(btn) {
  presets.forEach((p) => p.classList.remove("active"));
  if (btn) btn.classList.add("active");
  otherAmountInput.value = "";
}

presets.forEach((p) => p.addEventListener("click", () => setActivePreset(p)));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  statusEl.textContent = "";
  statusEl.style.color = "";
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
    statusEl.style.color = "red";
    return;
  }

  if (amount <= 0) {
    statusEl.textContent = "Please enter a valid donation amount.";
    statusEl.style.color = "red";
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
    submitBtn.textContent = "Processing...";
    submitBtn.setAttribute("aria-disabled", "true");
  }

  try {
    // console.log("Initiating Paytm transaction with payload:", payload);

    const response = await fetch(`${PUBLIC_API_URL}/api/paytm/initiate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amount,
        email: data.email,
        phone: data.phone,
        name: data.name,
      }),
    });

    const result = await response.json();

    if (result.success) {
      // Redirect to Paytm payment page
      const paytmUrl = `https://securegw-stage.paytm.in/theia/processTransaction?orderid=${result.orderId}&txnToken=${result.txnToken}&amount=${result.amount}&mid=${result.mid}`;
      window.location.href = paytmUrl;
    } else {
      statusEl.textContent = `Payment initiation failed: ${result.message || "Unknown error"}`;
      statusEl.style.color = "red";
      console.error("Payment initiation failed:", result);
    }
  } catch (error) {
    console.error("Payment error:", error);
    statusEl.textContent =
      "An error occurred while processing your payment. Please try again.";
    statusEl.style.color = "red";
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalBtnText;
      submitBtn.removeAttribute("aria-disabled");
    }
  }
});

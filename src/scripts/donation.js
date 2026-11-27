import { countries } from "../data/countries";

const form = document.getElementById("donation-form");
const presets = Array.from(document.querySelectorAll(".preset"));
const otherAmountInput = document.getElementById("otherAmount");
const statusEl = document.getElementById("form-status");
const submitBtn = form.querySelector('button[type="submit"]');
const pingBtn = document.getElementById("ping");
const panInput =
  document.getElementById("pan") ||
  (form && form.querySelector('input[name="pan"]'));

if (panInput) {
  panInput.addEventListener("input", (e) => {
    const el = e.target;
    const prevStart = el.selectionStart;
    const prevEnd = el.selectionEnd;
    // Force uppercase and strip any non-alphanumeric characters
    const cleaned = String(el.value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    el.value = cleaned;
    // Try to restore cursor position at end of input
    try {
      const pos = Math.min(cleaned.length, prevStart || cleaned.length);
      el.setSelectionRange(pos, pos);
    } catch (err) {
      // ignore if browser doesn't allow
    }
  });
}

// Nationality -> show country select when Non-Indian is chosen
const nationalityRadios = Array.from(
  document.querySelectorAll('input[name="nationality"]'),
);
const countryContainer = document.getElementById("country-container");
const countrySelect = document.getElementById("country");

// Minimal country list; can be expanded if needed

function populateCountries() {
  if (!countrySelect) return;
  // avoid duplicate population
  if (countrySelect.options.length > 1) return;
  countries.sort().forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    countrySelect.appendChild(opt);
  });
}

function updateCountryVisibility() {
  const selected = document.querySelector(
    'input[name="nationality"]:checked',
  )?.value;
  if (selected === "Non-Indian") {
    if (countryContainer) countryContainer.style.display = "";
    if (countrySelect) countrySelect.required = true;
    populateCountries();
  } else {
    if (countryContainer) countryContainer.style.display = "none";
    if (countrySelect) {
      countrySelect.required = false;
      countrySelect.value = "";
    }
  }
}

nationalityRadios.forEach((r) =>
  r.addEventListener("change", updateCountryVisibility),
);
// Initialize on load
updateCountryVisibility();

// Check for payment status in URL parameters
// This would have worked if we were not redirecting from the callback url, you can change this in the config set redirect = false.
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

const PAYTM_CHECKOUT_SRC =
  "https://secure.paytmpayments.com/merchantpgpui/checkoutjs/merchants/XSoslk96319757734940.js";

// Bounded so a CheckoutJS that loads but never signals ready becomes an error
// the donor can retry, instead of a button stuck on "Processing...".
const CHECKOUT_LOAD_TIMEOUT_MS = 15000;

// Read before any submit can run. A failed attempt relabels the button to
// "Try again", so reading it later would make that label permanent.
const SUBMIT_BTN_LABEL = submitBtn
  ? submitBtn.textContent.trim() || "Donate"
  : "Donate";

function lockSubmitBtn(label) {
  if (!submitBtn) return;
  submitBtn.disabled = true;
  submitBtn.textContent = label;
  submitBtn.setAttribute("aria-disabled", "true");
}

function releaseSubmitBtn(label = SUBMIT_BTN_LABEL) {
  if (!submitBtn) return;
  submitBtn.disabled = false;
  submitBtn.textContent = label;
  submitBtn.removeAttribute("aria-disabled");
}

// Paytm's checkout bundle does not depend on the order, so it downloads while
// the donor is still filling the form — only init(config) needs the token.
// Memoised, so a retry awaits the same load instead of appending a second
// <script> and opening a second checkout.
let checkoutScriptPromise = null;

function loadPaytmCheckout() {
  if (checkoutScriptPromise) return checkoutScriptPromise;

  checkoutScriptPromise = new Promise((resolve, reject) => {
    let settled = false;

    const fail = (message) => {
      if (settled) return;
      settled = true;
      // Drop the cached promise so the next submit retries the download
      // rather than awaiting one that has already rejected.
      checkoutScriptPromise = null;
      reject(new Error(message));
    };

    const timer = setTimeout(
      () => fail("Paytm checkout script timed out"),
      CHECKOUT_LOAD_TIMEOUT_MS,
    );

    const script = document.createElement("script");
    script.type = "application/javascript";
    script.src = PAYTM_CHECKOUT_SRC;
    script.crossOrigin = "anonymous";

    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      fail("Paytm checkout script failed to load");
    };

    script.onload = () => {
      if (!window.Paytm || !window.Paytm.CheckoutJS) {
        clearTimeout(timer);
        fail("Paytm CheckoutJS missing after script load");
        return;
      }
      // CheckoutJS carries on initialising after the tag fires onload, so
      // onLoad is what actually marks it usable.
      window.Paytm.CheckoutJS.onLoad(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(window.Paytm.CheckoutJS);
      });
    };

    document.body.appendChild(script);
  });

  return checkoutScriptPromise;
}

// Warm it now. A failure here is not worth showing anyone, because the submit
// path loads it again and reports the error where the donor can act on it.
loadPaytmCheckout().catch(() => {});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  statusEl.textContent = "";
  statusEl.style.color = "";

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

  // Require PAN for donations >= 2000
  if (amount >= 2000 && (!data.pan || String(data.pan).trim() === "")) {
    statusEl.textContent = "PAN is mandatory for donations of ₹2,000 or more.";
    statusEl.style.color = "red";
    return;
  }

  // If PAN provided, ensure it only contains letters and numbers (uppercased)
  if (data.pan && !/^[A-Z0-9]+$/.test(String(data.pan).toUpperCase())) {
    statusEl.textContent =
      "PAN can only contain letters and numbers (A–Z, 0–9).";
    statusEl.style.color = "red";
    return;
  }

  // Resolve nationality: if 'Indian' chosen -> 'India', otherwise use selected country
  let resolvedNationality = "";
  if (data.nationality === "Indian") resolvedNationality = "India";
  else if (data.nationality === "Non-Indian")
    resolvedNationality = data.country || "";

  const payload = {
    name: data.name,
    email: data.email,
    phone: data.phone,
    address: data.address || "",
    pan: data.pan ? String(data.pan).toUpperCase() : "",
    nationality: data.nationality,
    country: resolvedNationality,
    amount: amount,
    timestamp: new Date().toISOString(),
  };

  console.log("Initiating payment with payload:", payload);

  // The button stays locked from here through to the Paytm modal, released
  // only by a failure path or by notifyMerchant. Every window in which it
  // looks clickable is a window for a duplicate order.
  lockSubmitBtn("Processing...");

  try {
    const response = await fetch("/api/paytm/initiate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amount,
        email: data.email,
        phone: data.phone,
        name: data.name,
        address: data.address || "",
        pan: data.pan ? String(data.pan).toUpperCase() : "",
        nationality: data.nationality,
        country: resolvedNationality,
      }),
    });

    const result = await response.json();

    if (!result.success) {
      statusEl.textContent = `Payment initiation failed: ${result.message || "Unknown error"}`;
      statusEl.style.color = "red";
      console.error("Payment initiation failed:", result);
      releaseSubmitBtn();
      return;
    }

    let checkout;
    try {
      checkout = await loadPaytmCheckout();
    } catch (error) {
      console.error("Paytm checkout unavailable:", error);
      statusEl.textContent =
        "Couldn't reach Paytm. Please check your connection and try again.";
      statusEl.style.color = "red";
      releaseSubmitBtn("Try again");
      return;
    }

    lockSubmitBtn("Opening Paytm...");

    const config = {
      root: "",
      flow: "DEFAULT",
      data: {
        orderId: result.orderId,
        token: result.txnToken,
        tokenType: "TXN_TOKEN",
        amount: result.amount,
      },
      handler: {
        notifyMerchant: function (eventName, eventData) {
          console.log("notifyMerchant:", eventName, eventData);
          if (eventName === "APP_CLOSED") {
            releaseSubmitBtn();
          }
          if (eventName === "PAYMENT_ERROR") {
            releaseSubmitBtn("Try again");
          }
        },
      },
    };

    try {
      await checkout.init(config);
      checkout.invoke();
    } catch (error) {
      console.error("Paytm checkout failed to open:", error);
      statusEl.textContent =
        "Couldn't open the Paytm payment window. Please try again.";
      statusEl.style.color = "red";
      releaseSubmitBtn("Try again");
    }
  } catch (error) {
    console.error("Payment error:", error);
    statusEl.textContent =
      "An error occurred while processing your payment. Please try again.";
    statusEl.style.color = "red";
    releaseSubmitBtn();
  }
});

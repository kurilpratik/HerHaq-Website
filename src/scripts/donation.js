const form = document.getElementById("donation-form");
const presets = Array.from(document.querySelectorAll(".preset"));
const otherAmountInput = document.getElementById("otherAmount");
const statusEl = document.getElementById("form-status");
const submitBtn = form.querySelector('button[type="submit"]');
const pingBtn = document.getElementById("ping");
const PUBLIC_API_URL = import.meta.env.PUBLIC_API_URL;

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

  // Call the initiate route that we defined in index.js to get the transaction token and other details

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Processing...";
      submitBtn.setAttribute("aria-disabled", "true");
    }
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

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Processing...";
      submitBtn.setAttribute("aria-disabled", "true");
    }
    const result = await response.json();

    // Invokes the Paytm payment page with the received transaction token

    if (result.success) {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Opening Paytm...";
        submitBtn.setAttribute("aria-disabled", "true");
      }
      function loadPaytmCheckoutScript() {
        const script = document.createElement("script");
        script.type = "application/javascript";
        script.src =
          "https://secure.paytmpayments.com/merchantpgpui/checkoutjs/merchants/XSoslk96319757734940.js";
        script.crossOrigin = "anonymous";
        script.onload = onScriptLoad;
        document.body.appendChild(script);
      }
      loadPaytmCheckoutScript();

      function onScriptLoad() {
        var config = {
          root: "",
          flow: "DEFAULT",
          data: {
            orderId: result.orderId /* update order id */,
            token: result.txnToken /* update token value */,
            tokenType: "TXN_TOKEN",
            amount: result.amount /* update amount */,
          },
          handler: {
            notifyMerchant: function (eventName, data) {
              console.log("notifyMerchant handler function called");
              console.log("eventName => ", eventName);
              console.log("data => ", data);
              if (eventName === "APP_CLOSED") {
                submitBtn.disabled = false;
                submitBtn.textContent = originalBtnText;
                submitBtn.removeAttribute("aria-disabled");
              }
              if (eventName === "PAYMENT_ERROR") {
                submitBtn.disabled = false;
                submitBtn.textContent = "Try again";
                submitBtn.removeAttribute("aria-disabled");
              }
            },
          },
        };
        if (window.Paytm && window.Paytm.CheckoutJS) {
          window.Paytm.CheckoutJS.onLoad(function excecuteAfterCompleteLoad() {
            if (submitBtn) {
              submitBtn.disabled = true;
              submitBtn.textContent = "Opening Paytm...";
              submitBtn.setAttribute("aria-disabled", "true");
            }
            // initialze configuration using init method
            window.Paytm.CheckoutJS.init(config)
              .then(function onSuccess() {
                // after successfully updating configuration, invoke JS Checkout
                window.Paytm.CheckoutJS.invoke();
              })
              .catch(function onError(error) {
                console.log("error => ", error);
              });
          });
        }
      }
    } else {
      statusEl.textContent = `Payment initiation failed: ${result.message || "Unknown error"}`;
      statusEl.style.color = "red";
      console.error("Payment initiation failed:", result);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
        submitBtn.removeAttribute("aria-disabled");
      }
    }
  } catch (error) {
    console.error("Payment error:", error);
    statusEl.textContent =
      "An error occurred while processing your payment. Please try again.";
    statusEl.style.color = "red";
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalBtnText;
      submitBtn.removeAttribute("aria-disabled");
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalBtnText;
      submitBtn.removeAttribute("aria-disabled");
    }
  }
});

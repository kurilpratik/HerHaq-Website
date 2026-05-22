import express from "express";
import cors from "cors";
import PaytmChecksum from "paytmchecksum";

const app = express();
app.use(express.json());
app.use(cors());

// Paytm Configuration
const PAYTM_MERCHANT_ID = process.env.PAYTM_MERCHANT_ID;
const PAYTM_MERCHANT_KEY = process.env.PAYTM_MERCHANT_KEY;
const PAYTM_WEBSITE = process.env.PAYTM_WEBSITE || "WEBSTAGING";
const PAYTM_CHANNEL_ID = process.env.PAYTM_CHANNEL_ID || "WEB";
const PAYTM_INDUSTRY_TYPE = process.env.PAYTM_INDUSTRY_TYPE || "Retail";

// For staging environment
const PAYTM_TXN_URL =
  process.env.PAYTM_TXN_URL ||
  "https://securegw-stage.paytm.in/theia/api/v1/initiateTransaction";
const PAYTM_STATUS_URL =
  process.env.PAYTM_STATUS_URL ||
  "https://securegw-stage.paytm.in/theia/api/v1/transactionStatus";

app.get("/api/ping", (req, res) => {
  res.json({ status: "ok", message: "Express backend connected" });
});

// Initiate Paytm Transaction
app.post("/api/paytm/initiate", async (req, res) => {
  try {
    const { amount, email, phone, name, orderId } = req.body;

    if (!amount || !email || !phone || !name) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Generate unique order ID if not provided
    const uniqueOrderId =
      orderId || `DON_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    orderId = Json.stringify(uniqueOrderId).replace(/"/g, ""); // Remove quotes if any

    const paytmParams = {
      body: {
        requestType: "Payment",
        mid: PAYTM_MERCHANT_ID,
        websiteName: PAYTM_WEBSITE,
        orderId: orderId,
        callbackUrl: `${req.protocol}://${req.get("host")}/api/paytm/callback`,
        txnAmount: {
          value: amount.toString(),
          currency: "INR",
        },
        userInfo: {
          custId: email,
          email: email,
          mobile: phone,
          name: name,
        },
      },
    };

    // Generate checksum
    const checksum = await PaytmChecksum.generateSignature(
      JSON.stringify(paytmParams.body),
      PAYTM_MERCHANT_KEY,
    );

    paytmParams.head = {
      signature: checksum,
    };

    const response = await fetch(
      `${PAYTM_TXN_URL}?mid=${PAYTM_MERCHANT_ID}&orderId=${orderId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(paytmParams),
      },
    );

    const data = await response.json();

    if (data.body && data.body.txnToken) {
      res.json({
        success: true,
        orderId: orderId,
        txnToken: data.body.txnToken,
        amount: amount,
        mid: PAYTM_MERCHANT_ID,
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to initiate transaction",
        error: data,
      });
    }
  } catch (error) {
    console.error("Paytm initiation error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during transaction initiation",
      error: error.message,
    });
  }
});

// Paytm Callback Handler
app.post("/api/paytm/callback", async (req, res) => {
  try {
    const paytmParams = {};
    paytmParams.body = req.body;

    const isValid = await PaytmChecksum.verifySignature(
      paytmParams.body,
      PAYTM_MERCHANT_KEY,
      paytmParams.head.signature,
    );

    if (isValid) {
      console.log("Checksum Matched");

      // Check transaction status
      const statusParams = {
        body: {
          mid: PAYTM_MERCHANT_ID,
          orderId: req.body.ORDERID,
        },
      };

      const checksum = await PaytmChecksum.generateSignature(
        JSON.stringify(statusParams.body),
        PAYTM_MERCHANT_KEY,
      );

      statusParams.head = {
        signature: checksum,
      };

      const statusResponse = await fetch(PAYTM_STATUS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(statusParams),
      });

      const statusData = await statusResponse.json();

      // Redirect to frontend with status
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:4321";
      const status = statusData.body.resultInfo.resultStatus;

      res.redirect(
        `${frontendUrl}/donate?status=${status}&orderId=${req.body.ORDERID}`,
      );
    } else {
      console.log("Checksum Mismatched");
      res.redirect(
        `${process.env.FRONTEND_URL || "http://localhost:4321"}/donate?status=failure`,
      );
    }
  } catch (error) {
    console.error("Callback error:", error);
    res.redirect(
      `${process.env.FRONTEND_URL || "http://localhost:4321"}/donate?status=failure`,
    );
  }
});

// Check Transaction Status
app.post("/api/paytm/status", async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Order ID is required",
      });
    }

    const paytmParams = {
      body: {
        mid: PAYTM_MERCHANT_ID,
        orderId: orderId,
      },
    };

    const checksum = await PaytmChecksum.generateSignature(
      JSON.stringify(paytmParams.body),
      PAYTM_MERCHANT_KEY,
    );

    paytmParams.head = {
      signature: checksum,
    };

    const response = await fetch(PAYTM_STATUS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(paytmParams),
    });

    const data = await response.json();

    res.json({
      success: true,
      data: data,
    });
  } catch (error) {
    console.error("Status check error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during status check",
      error: error.message,
    });
  }
});

// app.post("/api/donate", (req, res) => {
//   console.log("Donate payload received:", req.body);
//   res.json({ status: "ok", received: true });
// });

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Express backend listening on http://localhost:${port}`);
});

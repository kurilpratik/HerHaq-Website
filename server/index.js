import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import PaytmChecksum from "paytmchecksum";
import { supabase } from "./lib/supabase.js";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
  console.log("Initiate transaction payload:", req.body);
  try {
    const { amount, email, phone, name, address, pan, nationality, country } =
      req.body;

    if (!amount || !email || !phone || !name) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Generate unique order ID if not provided
    const orderId = `DON_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    //orderId = orderId + "";

    //orderId = Json.stringify(uniqueOrderId).replace(/"/g, ""); // Remove quotes if any

    // Saving the order details to Supabase first
    const { error } = await supabase.from("donations").insert({
      order_id: orderId,
      name,
      email,
      phone,
      amount,
      address,
      pan,
      nationality,
      country,
      status: "INITIATED",
    });

    if (error) {
      console.error(error);
      throw error;
    } else {
      console.log("Order saved to database with ID:", orderId);
    }

    const paytmParams = {
      body: {
        requestType: "Payment",
        mid: PAYTM_MERCHANT_ID,
        websiteName: PAYTM_WEBSITE,
        orderId: orderId,
        callbackUrl: `${req.protocol}s://${req.get("host")}/api/paytm/callback`,
        txnAmount: {
          value: amount.toString(),
          currency: "INR",
        },
        userInfo: {
          custId: email, // This only returns, you can use it for PAN
          email: email,
          mobile: phone,
          name: name,
        },
      },
    };

    //console.log("Initiating Paytm transaction with params:", paytmParams);

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
    console.log("Paytm initiation response:", data);

    if (data.body && data.body.txnToken) {
      //console.log("Paytm initiation successful:", data);
      res.json({
        success: true,
        orderId: orderId,
        txnToken: data.body.txnToken,
        amount: amount,
        mid: PAYTM_MERCHANT_ID,
      });
      // Update the order in Supabase with the transaction token
      await supabase
        .from("donations")
        .update({
          status,
          txn_id: result.body.txnId,
          paytm_response: result.body,
          updated_at: new Date(),
        })
        .eq("order_id", orderId);
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

app.post("/api/paytm/callback", async (req, res) => {
  try {
    //console.log("Callback payload received:", req.body);

    const { ORDERID, TXNID, STATUS, CHECKSUMHASH } = req.body;

    // Verify checksum
    const isValidChecksum = PaytmChecksum.verifySignature(
      req.body,
      PAYTM_MERCHANT_KEY,
      CHECKSUMHASH,
    );

    if (!isValidChecksum) {
      return res.status(400).send("Checksum verification failed");
    }

    // Query Paytm for definitive transaction status
    const paytmParams = {
      body: {
        mid: PAYTM_MERCHANT_ID,
        orderId: ORDERID,
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

    const result = await response.json();

    //console.log("Verified status:", result);

    if (result.body.resultInfo.resultStatus === "TXN_SUCCESS") {
      // save donation to DB
      // mark order paid
      // send email
    }

    res.redirect(
      `https://herhaq.com/payment-status?status=${result.body.resultInfo.resultStatus}`,
    );
  } catch (err) {
    console.error(err);
    res.status(500).send("Payment verification failed");
  }
});

// Paytm Callback Handler
// app.post("/api/paytm/callback", async (req, res) => {
//   try {
//     let payload = req.body || {};

//     if (typeof payload.body === "string") {
//       try {
//         payload.body = JSON.parse(payload.body);
//       } catch (err) {
//         // keep original body if not JSON
//       }
//     }

//     if (typeof payload.head === "string") {
//       try {
//         payload.head = JSON.parse(payload.head);
//       } catch (err) {
//         // keep original head if not JSON
//       }
//     }

//     // Try to get order id from common fields
//     const orderId =
//       payload.ORDERID ||
//       payload.orderId ||
//       payload.orderID ||
//       payload.order_id ||
//       payload.ORDER_ID ||
//       payload.body?.ORDERID ||
//       payload.body?.orderId ||
//       payload.body?.orderID;

//     if (!orderId) {
//       return res.status(400).json({
//         success: false,
//         status: "failure",
//         message: "Missing order ID in callback payload",
//       });
//     }

//     // Verify checksum/signature if present
//     let isValid = true;
//     try {
//       const checksum =
//         payload.head?.signature ||
//         payload.CHECKSUMHASH ||
//         payload.checksum ||
//         payload.signature;

//       if (checksum) {
//         const verifyPayload = payload.head?.signature
//           ? payload.body || {}
//           : payload;
//         isValid = await PaytmChecksum.verifySignature(
//           JSON.stringify(verifyPayload),
//           PAYTM_MERCHANT_KEY,
//           checksum,
//         );
//       }
//     } catch (err) {
//       console.warn("Checksum verification failed:", err?.message || err);
//       isValid = false;
//     }

//     if (!isValid) {
//       return res.status(400).json({
//         success: false,
//         status: "failure",
//         message: "Checksum verification failed",
//       });
//     }

//     // Build status request to Paytm to get canonical status
//     const statusParams = {
//       body: {
//         mid: PAYTM_MERCHANT_ID,
//         orderId: orderId,
//       },
//     };

//     const statusChecksum = await PaytmChecksum.generateSignature(
//       JSON.stringify(statusParams.body),
//       PAYTM_MERCHANT_KEY,
//     );

//     statusParams.head = {
//       signature: statusChecksum,
//     };

//     const statusResponse = await fetch(PAYTM_STATUS_URL, {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify(statusParams),
//     });

//     const statusData = await statusResponse.json();

//     // Determine result status from Paytm response
//     const resultStatus =
//       statusData?.body?.resultInfo?.resultStatus || statusData?.body?.txnStatus;

//     // Map Paytm status to frontend-friendly status and message
//     let statusKey = "failure";
//     let message = "Payment failed or unknown status";

//     if (resultStatus === "TXN_SUCCESS" || resultStatus === "SUCCESS") {
//       statusKey = "success";
//       message = "Payment successful";
//     } else if (
//       resultStatus === "PENDING" ||
//       resultStatus === "SUBMITTED" ||
//       resultStatus === "IN_PROGRESS"
//     ) {
//       statusKey = "pending";
//       message = "Payment is pending";
//     }

//     // Return JSON to frontend with an appropriate message
//     return res.json({
//       success: statusKey === "success",
//       status: statusKey,
//       message,
//       orderId,
//       raw: statusData?.body,
//     });
//   } catch (error) {
//     console.error("Callback error:", error);
//     return res.status(500).json({
//       success: false,
//       status: "failure",
//       message: "Server error while processing callback",
//       error: error.message,
//     });
//   }
// });

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

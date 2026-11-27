import { json } from "../../../lib/http.js";
import { fetchOrderStatus, paytmConfig } from "../../../lib/paytm.js";

export const prerender = false;

export const POST = async ({ request }) => {
  try {
    const { orderId } = (await request.json()) || {};
    if (!orderId) {
      return json({ success: false, message: "Order ID is required" }, 400);
    }

    const data = await fetchOrderStatus(paytmConfig(), orderId);
    return json({ success: true, data });
  } catch (error) {
    console.error("Status check error:", error);
    return json(
      {
        success: false,
        message: "Server error during status check",
        error: error.message,
      },
      500,
    );
  }
};

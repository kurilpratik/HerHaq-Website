import { json } from "../../../lib/http.js";

export const prerender = false;

const LIMITS = { firstName: 100, lastName: 100, email: 254 };

export const POST = async ({ request }) => {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ success: false, message: "Invalid request body." }, 400);
  }

  const { firstName, lastName, email, website } = payload || {};

  // Honeypot: bots fill hidden fields, humans do not
  if (typeof website === "string" && website.trim()) {
    return json({ success: true });
  }

  for (const [field, value] of Object.entries({ firstName, lastName, email })) {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.trim().length > LIMITS[field]
    ) {
      const label = field.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`);
      return json(
        { success: false, message: `Please provide a valid ${label}.` },
        400,
      );
    }
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return json(
      { success: false, message: "Please provide a valid email address." },
      400,
    );
  }

  // NOTE: carried over as-is from the Express version -- this endpoint has
  // never persisted anything. Subscribers only ever reached the logs.
  console.log("Newsletter signup:", {
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    email: normalizedEmail,
  });

  return json({ success: true }, 201);
};

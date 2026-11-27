import { json } from "../../lib/http.js";

export const prerender = false;

export const GET = () =>
  json({ status: "ok", message: "Astro API connected" });

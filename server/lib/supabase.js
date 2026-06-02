import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl) {
  throw new Error("Missing SupabaseUrl.");
}
if (!supabaseKey) {
  throw new Error("Missing SupabaseKey.");
}

export const supabase = createClient(supabaseUrl, supabaseKey);

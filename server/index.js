import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

app.get("/api/ping", (req, res) => {
  res.json({ status: "ok", message: "Express backend connected" });
});

app.post("/api/donate", (req, res) => {
  console.log("Donate payload received:", req.body);
  res.json({ status: "ok", received: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Express backend listening on http://localhost:${port}`);
});

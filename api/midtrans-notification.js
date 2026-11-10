import crypto from "crypto";
import { db } from "./_admin.js";

export default async function handler(req, res) {
  const n = req.body || {};
  const expected = crypto
    .createHash("sha512")
    .update(String(n.order_id) + String(n.status_code) + String(n.gross_amount) + process.env.MIDTRANS_SERVER_KEY)
    .digest("hex");
  if (expected !== n.signature_key) return res.status(403).end();

  const txId = n.order_id.slice(0, n.order_id.lastIndexOf("-"));
  const ref = db.collection("transaksi").doc(txId);
  const snap = await ref.get();
  if (!snap.exists) return res.status(200).end();
  const tx = snap.data();

  const paid =
    n.transaction_status === "settlement" ||
    (n.transaction_status === "capture" && n.fraud_status === "accept");

  if (paid && tx.status !== "Lunas") {
    const now = new Date().toISOString();
    const method = `Midtrans (${n.payment_type})`;
    const base = tx.history && tx.history.length ? tx.history : [];
    await ref.update({
      status: "Lunas",
      method,
      paidAt: now,
      payRef: n.transaction_id,
      history: [
        ...base,
        { time: now, action: "Pembayaran diterima, menunggu persetujuan fotografer", method, ref: n.transaction_id, status: "Lunas" },
      ],
    });
    await db.collection("pesanan_publik").doc(txId).update({ status: "Lunas" });
  }
  res.status(200).end();
}

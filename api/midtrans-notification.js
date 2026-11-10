import { db } from "./_admin.js";

export default async function handler(req, res) {
  try {
    const n = req.body || {};
    const orderId = String(n.order_id || "");
    if (!orderId) return res.status(200).end();

    // Tanya langsung ke Midtrans, jangan percaya isi body begitu saja
    const r = await fetch(
      `https://api.sandbox.midtrans.com/v2/${encodeURIComponent(orderId)}/status`,
      {
        headers: {
          Accept: "application/json",
          Authorization: "Basic " + Buffer.from(process.env.MIDTRANS_SERVER_KEY + ":").toString("base64"),
        },
      }
    );
    const s = await r.json();
    if (!r.ok || String(s.order_id) !== orderId) {
      console.log("Status check gagal", orderId, r.status, s.status_message);
      return res.status(200).end();
    }

    const txId = orderId.slice(0, orderId.lastIndexOf("-"));
    const ref = db.collection("transaksi").doc(txId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(200).end();
    const tx = snap.data();

    const paid =
      s.transaction_status === "settlement" ||
      (s.transaction_status === "capture" && s.fraud_status === "accept");

    if (paid && tx.status !== "Lunas" && parseInt(s.gross_amount, 10) === tx.price) {
      const now = new Date().toISOString();
      const method = `Midtrans (${s.payment_type})`;
      const base = tx.history && tx.history.length ? tx.history : [];
      await ref.update({
        status: "Lunas",
        method,
        paidAt: now,
        payRef: s.transaction_id,
        history: [
          ...base,
          { time: now, action: "Pembayaran diterima, menunggu persetujuan fotografer", method, ref: s.transaction_id, status: "Lunas" },
        ],
      });
      await db.collection("pesanan_publik").doc(txId).update({ status: "Lunas" });
    }
    return res.status(200).end();
  } catch (e) {
    console.error(e);
    return res.status(500).end();
  }
}

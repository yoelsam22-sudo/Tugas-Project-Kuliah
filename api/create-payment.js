import { db, auth, cors } from "./_admin.js";

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();

  try {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    const user = await auth.verifyIdToken(token);

    const { id } = req.body;
    const ref = db.collection("transaksi").doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Pesanan tidak ada" });
    const tx = snap.data();

    if (tx.uid !== user.uid) return res.status(403).json({ error: "Bukan pesananmu" });
    if (tx.status === "Lunas") return res.status(400).json({ error: "Sudah dibayar" });
    if (!["Menunggu", "Disetujui"].includes(tx.approval || "Disetujui"))
      return res.status(400).json({ error: "Pesanan tidak aktif" });

    const orderId = `${tx.id}-${Date.now()}`;
    const r = await fetch("https://app.sandbox.midtrans.com/snap/v1/transactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(process.env.MIDTRANS_SERVER_KEY + ":").toString("base64"),
      },
      body: JSON.stringify({
        transaction_details: { order_id: orderId, gross_amount: tx.price },
        item_details: [{ id: tx.packageId, price: tx.price, quantity: 1, name: tx.packageName }],
        customer_details: { first_name: tx.name, email: tx.email },
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: data });

    await ref.update({ payOrderId: orderId });
    res.json({ token: data.token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message || e) });
  }
}

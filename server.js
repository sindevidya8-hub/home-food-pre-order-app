const express = require("express");
const cors = require("cors");
const supabase = require("./supabase");

const app = express();
const PORT = Number(process.env.PORT || 5000);

app.use(cors());
app.use(express.json({ limit: "100kb" }));

const allowedCategories = new Set(["veg", "non-veg", "snacks"]);

function validUUID(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function cleanString(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function sendError(res, status, error) {
  console.error(error);
  return res.status(status).json({ error: typeof error === "string" ? error : "Server error." });
}

app.get("/api/health", async (_req, res) => {
  const { error } = await supabase.from("meals").select("id").limit(1);
  if (error) return res.status(503).json({ ok: false, error: "Database connection failed." });
  res.json({ ok: true, service: "home-food-pre-order-api" });
});

app.get("/api/meals", async (req, res) => {
  try {
    const category = cleanString(req.query.category, 20);
    let query = supabase
      .from("meals")
      .select("id,name,description,category,price,prep_minutes,available_quantity,emoji,created_at")
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (category && allowedCategories.has(category)) query = query.eq("category", category);

    const { data, error } = await query;
    if (error) return sendError(res, 500, "Could not load meals.");
    res.json({ meals: data || [] });
  } catch (error) {
    sendError(res, 500, error);
  }
});

app.get("/api/orders", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("id,customer_name,phone,pickup_date,pickup_time,notes,total_amount,status,created_at,order_items(quantity,unit_price,meals(name))")
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) return sendError(res, 500, "Could not load orders.");
    res.json({ orders: data || [] });
  } catch (error) {
    sendError(res, 500, error);
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const name = cleanString(req.body.customer_name, 80);
    const phone = cleanString(req.body.phone, 15);
    const pickupDate = cleanString(req.body.pickup_date, 10);
    const pickupTime = cleanString(req.body.pickup_time, 5);
    const notes = cleanString(req.body.notes, 250);
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (name.length < 2) return res.status(400).json({ error: "Name must contain at least 2 characters." });
    if (!/^[0-9]{10}$/.test(phone)) return res.status(400).json({ error: "Phone must contain exactly 10 digits." });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) return res.status(400).json({ error: "Invalid pickup date." });
    if (!/^\d{2}:\d{2}$/.test(pickupTime)) return res.status(400).json({ error: "Invalid pickup time." });
    if (!items.length || items.length > 20) return res.status(400).json({ error: "Add between 1 and 20 cart items." });

    const normalized = [];
    for (const item of items) {
      if (!validUUID(item.meal_id)) return res.status(400).json({ error: "Invalid meal selected." });
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
        return res.status(400).json({ error: "Each quantity must be a whole number from 1 to 20." });
      }
      normalized.push({ meal_id: item.meal_id, quantity });
    }

    const { data: meals, error: mealError } = await supabase
      .from("meals")
      .select("id,name,price,available_quantity,is_active")
      .in("id", normalized.map(item => item.meal_id));

    if (mealError) return sendError(res, 500, "Could not verify selected meals.");
    if (!meals || meals.length !== new Set(normalized.map(item => item.meal_id)).size) {
      return res.status(400).json({ error: "One or more selected meals no longer exist." });
    }

    const mealMap = new Map(meals.map(meal => [meal.id, meal]));
    let total = 0;
    const orderItems = [];

    for (const item of normalized) {
      const meal = mealMap.get(item.meal_id);
      if (!meal.is_active) return res.status(400).json({ error: `${meal.name} is no longer available.` });
      if (meal.available_quantity < item.quantity) {
        return res.status(400).json({ error: `Only ${meal.available_quantity} portion(s) of ${meal.name} are available.` });
      }
      const lineTotal = Number(meal.price) * item.quantity;
      total += lineTotal;
      orderItems.push({ meal_id: meal.id, quantity: item.quantity, unit_price: meal.price });
    }

    // The SQL function performs the order insert and quantity decrement atomically.
    const { data, error } = await supabase.rpc("create_preorder", {
      p_customer_name: name,
      p_phone: phone,
      p_pickup_date: pickupDate,
      p_pickup_time: pickupTime,
      p_notes: notes || null,
      p_items: orderItems
    });

    if (error) {
      console.error(error);
      return res.status(400).json({ error: error.message || "Could not place order." });
    }

    res.status(201).json({ order: data, total_amount: total });
  } catch (error) {
    sendError(res, 500, error);
  }
});

app.use((_req, res) => res.status(404).json({ error: "Route not found." }));

app.listen(PORT, () => {
  console.log(`HomeBite API running at http://localhost:${PORT}`);
});

const API_BASE = window.HOMEBITE_API_BASE || "http://localhost:5000/api";

const state = {
  meals: [],
  cart: [],
  category: "all",
  search: ""
};

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}

function money(value) {
  return `₹${Number(value).toFixed(0)}`;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function renderMeals() {
  const grid = $("#mealsGrid");
  const empty = $("#mealsEmpty");
  const query = state.search.trim().toLowerCase();

  const filtered = state.meals.filter(meal => {
    const matchesCategory = state.category === "all" || meal.category === state.category;
    const haystack = `${meal.name} ${meal.description} ${meal.category}`.toLowerCase();
    return matchesCategory && haystack.includes(query);
  });

  grid.innerHTML = filtered.map(meal => `
    <article class="meal-card">
      <div class="meal-art">
        <span class="badge">${escapeHtml(meal.category)}</span>
        <span>${escapeHtml(meal.emoji || "🍛")}</span>
      </div>
      <div class="meal-body">
        <div class="meal-top"><h3 class="meal-title">${escapeHtml(meal.name)}</h3><span class="price">${money(meal.price)}</span></div>
        <p class="meal-description">${escapeHtml(meal.description)}</p>
        <div class="meal-meta"><span>⏱ ${escapeHtml(meal.prep_minutes)} min</span><span>•</span><span>📦 ${escapeHtml(meal.available_quantity)} left</span></div>
        <div class="card-actions">
          <button class="add-btn" data-add="${meal.id}" ${meal.available_quantity < 1 ? "disabled" : ""}>${meal.available_quantity < 1 ? "Sold out" : "Add to cart"}</button>
          <button class="details-btn" data-detail="${meal.id}">View</button>
        </div>
      </div>
    </article>
  `).join("");

  empty.classList.toggle("hidden", filtered.length > 0);
}

async function loadMeals() {
  $("#mealsLoading").classList.remove("hidden");
  $("#mealsGrid").innerHTML = "";
  try {
    const data = await api("/meals");
    state.meals = data.meals || [];
    renderMeals();
  } catch (error) {
    $("#mealsEmpty").classList.remove("hidden");
    $("#mealsEmpty").innerHTML = `<div>⚠️</div><h3>Couldn't load meals</h3><p>${escapeHtml(error.message)}<br>Check that the backend is running.</p>`;
  } finally {
    $("#mealsLoading").classList.add("hidden");
  }
}

function cartCount() {
  return state.cart.reduce((sum, item) => sum + item.quantity, 0);
}

function cartTotal() {
  return state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function updateCartUI() {
  $("#cartCount").textContent = cartCount();
  $("#cartTotal").textContent = money(cartTotal());

  $("#cartItems").innerHTML = state.cart.length ? state.cart.map(item => `
    <div class="cart-item">
      <div><strong>${escapeHtml(item.name)}</strong><br><small>${money(item.price)} each</small></div>
      <div class="qty-controls">
        <button data-dec="${item.id}" aria-label="Decrease">−</button>
        <strong>${item.quantity}</strong>
        <button data-inc="${item.id}" aria-label="Increase">+</button>
      </div>
      <button class="remove-btn" data-remove="${item.id}">Remove</button>
    </div>
  `).join("") : `<div class="empty-state"><div>🛒</div><h3>Your cart is empty</h3><p>Add a meal before checking out.</p></div>`;
}

function addToCart(id) {
  const meal = state.meals.find(item => item.id === id);
  if (!meal || meal.available_quantity < 1) return;
  const existing = state.cart.find(item => item.id === id);
  if (existing) {
    if (existing.quantity >= meal.available_quantity) return showToast("You reached the available quantity.");
    existing.quantity += 1;
  } else {
    state.cart.push({ id: meal.id, name: meal.name, price: Number(meal.price), quantity: 1, max: meal.available_quantity });
  }
  updateCartUI();
  showToast(`${meal.name} added to cart`);
}

function changeQuantity(id, delta) {
  const item = state.cart.find(entry => entry.id === id);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) state.cart = state.cart.filter(entry => entry.id !== id);
  if (item.quantity > item.max) item.quantity = item.max;
  updateCartUI();
}

const CART_MODAL_ID = "cartModal";
const DETAIL_MODAL_ID = "detailModal";

function openModal(id) {
  document.getElementById(id).classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
  document.body.style.overflow = "";
}

function openDetails(id) {
  const meal = state.meals.find(item => item.id === id);
  if (!meal) return;
  $("#detailContent").innerHTML = `
    <div class="detail-emoji">${escapeHtml(meal.emoji || "🍛")}</div>
    <p class="eyebrow">${escapeHtml(meal.category)}</p>
    <h2 id="detailTitle">${escapeHtml(meal.name)}</h2>
    <p class="detail-description">${escapeHtml(meal.description)}</p>
    <p>Preparation time: <strong>${escapeHtml(meal.prep_minutes)} minutes</strong></p>
    <p>Available portions: <strong>${escapeHtml(meal.available_quantity)}</strong></p>
    <p class="detail-price">${money(meal.price)}</p>
    <button class="primary-btn full" data-add-detail="${meal.id}">Add to cart</button>
  `;
  openModal(DETAIL_MODAL_ID);
}

function renderOrders(orders) {
  const list = $("#ordersList");
  $("#ordersEmpty").classList.toggle("hidden", orders.length > 0);
  list.innerHTML = orders.map(order => `
    <article class="order-card">
      <div>
        <h3>Order #${escapeHtml(order.id.slice(0, 8))}</h3>
        <p>${escapeHtml(order.customer_name)} • ${escapeHtml(order.phone)}</p>
        <p>Pickup: ${escapeHtml(order.pickup_date)} at ${escapeHtml(order.pickup_time)}</p>
        <span class="status">${escapeHtml(order.status)}</span>
      </div>
      <div class="order-price">${money(order.total_amount)}</div>
    </article>
  `).join("");
}

async function loadOrders() {
  $("#ordersLoading").classList.remove("hidden");
  try {
    const data = await api("/orders");
    renderOrders(data.orders || []);
  } catch (error) {
    $("#ordersList").innerHTML = `<div class="empty-state"><div>⚠️</div><h3>Couldn't load orders</h3><p>${escapeHtml(error.message)}</p></div>`;
    $("#ordersEmpty").classList.add("hidden");
  } finally {
    $("#ordersLoading").classList.add("hidden");
  }
}

function setMinPickupDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  $("#pickupDate").min = local;
  $("#pickupDate").value = local;
}

$("#searchInput").addEventListener("input", event => {
  state.search = event.target.value;
  renderMeals();
});

$("#categoryFilters").addEventListener("click", event => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  state.category = button.dataset.category;
  document.querySelectorAll(".filter").forEach(el => el.classList.remove("active"));
  button.classList.add("active");
  renderMeals();
});

$("#mealsGrid").addEventListener("click", event => {
  const add = event.target.closest("[data-add]");
  const detail = event.target.closest("[data-detail]");
  if (add) addToCart(add.dataset.add);
  if (detail) openDetails(detail.dataset.detail);
});

document.addEventListener("click", event => {
  const inc = event.target.closest("[data-inc]");
  const dec = event.target.closest("[data-dec]");
  const remove = event.target.closest("[data-remove]");
  const addDetail = event.target.closest("[data-add-detail]");
  const close = event.target.closest("[data-close]");
  if (inc) changeQuantity(inc.dataset.inc, 1);
  if (dec) changeQuantity(dec.dataset.dec, -1);
  if (remove) {
    state.cart = state.cart.filter(item => item.id !== remove.dataset.remove);
    updateCartUI();
  }
  if (addDetail) {
    addToCart(addDetail.dataset.addDetail);
    closeModal(DETAIL_MODAL_ID);
  }
  if (close) closeModal(close.dataset.close);
});

$("#cartButton").addEventListener("click", () => {
  updateCartUI();
  openModal(CART_MODAL_ID);
});
$("#refreshMeals").addEventListener("click", loadMeals);
$("#refreshOrders").addEventListener("click", loadOrders);

$("#orderForm").addEventListener("submit", async event => {
  event.preventDefault();
  const message = $("#orderMessage");
  if (!state.cart.length) {
    message.textContent = "Add at least one meal to your cart.";
    return;
  }

  const name = $("#customerName").value.trim();
  const phone = $("#customerPhone").value.trim();
  const pickupDate = $("#pickupDate").value;
  const pickupTime = $("#pickupTime").value;
  const notes = $("#orderNotes").value.trim();

  if (name.length < 2) return message.textContent = "Please enter your name.";
  if (!/^[0-9]{10}$/.test(phone)) return message.textContent = "Enter a valid 10-digit phone number.";
  if (!pickupDate || !pickupTime) return message.textContent = "Select pickup date and time.";

  const button = $("#placeOrderBtn");
  button.disabled = true;
  button.textContent = "Placing order...";
  message.textContent = "";

  try {
    await api("/orders", {
      method: "POST",
      body: JSON.stringify({
        customer_name: name,
        phone,
        pickup_date: pickupDate,
        pickup_time: pickupTime,
        notes,
        items: state.cart.map(item => ({ meal_id: item.id, quantity: item.quantity }))
      })
    });
    state.cart = [];
    updateCartUI();
    event.target.reset();
    setMinPickupDate();
    message.textContent = "Order placed successfully!";
    message.style.color = "#3d704c";
    showToast("Your pre-order is confirmed 🎉");
    await loadMeals();
    await loadOrders();
    setTimeout(() => closeModal(CART_MODAL_ID), 1000);
  } catch (error) {
    message.textContent = error.message;
    message.style.color = "#b55b4c";
  } finally {
    button.disabled = false;
    button.textContent = "Place pre-order";
  }
});

$("#navToggle").addEventListener("click", () => $("#navLinks").classList.toggle("open"));
document.querySelectorAll(".nav-links a").forEach(link => link.addEventListener("click", () => $("#navLinks").classList.remove("open")));

document.querySelectorAll(".modal").forEach(modal => modal.addEventListener("click", event => {
  if (event.target === modal) closeModal(modal.id);
}));
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    document.querySelectorAll(".modal:not(.hidden)").forEach(modal => closeModal(modal.id));
  }
});

setMinPickupDate();
updateCartUI();
loadMeals();
loadOrders();

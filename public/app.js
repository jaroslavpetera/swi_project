const $ = (id) => document.getElementById(id);
const labels = {
  DRAFT: "Rozpracovaná",
  PENDING_APPROVAL: "Čeká na schválení",
  CONFIRMED: "Potvrzená",
  CANCELLED: "Zrušená",
  REJECTED: "Zamítnutá",
  EXPIRED: "Vypršená",
  PLACED: "Objednáno",
  SERVED: "Podáno",
  PAID: "Zaplaceno",
};
let users = [],
  resources = [],
  reservations = [],
  orderReservations = [],
  menuItems = [];
let reservationVersion = 0,
  orderVersion = 0,
  tabVersion = 0;
let reservationLoading = false,
  orderLoading = false,
  orderBusy = false;
let reservationError = "";

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function notice(message, tone = "success") {
  $("notice").textContent = message;
  $("notice").dataset.tone = tone;
  $("notice").hidden = false;
}
function errorMessage(status, body) {
  const reason = {
    NOT_CONFIRMED: "Rezervace ještě není potvrzená.",
    BEFORE_START: "Návštěva ještě nezačala. Objednejte až v čase rezervace.",
    AFTER_END: "Návštěva již skončila.",
  };
  if (reason[body?.reason]) return reason[body.reason];
  const error = typeof body?.error === "string" ? body.error : "";
  if (/overlap|conflict/i.test(error))
    return "Stůl už má v tomto termínu jinou potvrzenou rezervaci.";
  if (/cancel.*window|started|already begun/i.test(error))
    return "Rezervaci po začátku návštěvy nelze zrušit.";
  if (status === 410)
    return "Čas pro potvrzení nebo schválení vypršel. Vytvořte novou rezervaci.";
  if (status === 409)
    return "Akci nelze v aktuálním stavu provést. Obnovte přehled a zkontrolujte termín.";
  if (status === 404) return "Záznam již není dostupný. Obnovte přehled.";
  if (status === 400)
    return "Zkontrolujte vyplněné údaje a vyberte platný stůl, hosta a termín.";
  return "Data se nepodařilo načíst nebo uložit. Zkuste akci znovu.";
}
async function request(url, data) {
  let response;
  try {
    response = await fetch(
      url,
      data === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          },
    );
  } catch {
    throw new Error(
      "Spojení se serverem se nezdařilo. Zkontrolujte připojení a zkuste to znovu.",
    );
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("Server vrátil neplatnou odpověď. Zkuste to znovu.");
  }
  if (!response.ok) throw new Error(errorMessage(response.status, body));
  return body;
}
async function run(task, button) {
  if (button?.disabled) return;
  if (button) {
    button.disabled = true;
    button.dataset.busy = "true";
  }
  try {
    await task();
  } catch (error) {
    notice(error.message, "error");
  } finally {
    if (button) {
      button.disabled = false;
      delete button.dataset.busy;
    }
    updateControls();
  }
}
function fillSelect(select, items, label, empty = "Žádné záznamy") {
  const previous = select.value;
  select.replaceChildren();
  for (const item of items) {
    const option = node("option", label(item));
    option.value = item.id;
    select.append(option);
  }
  if (!items.length) {
    const option = node("option", empty);
    option.value = "";
    select.append(option);
  }
  if (items.some((item) => item.id === previous)) select.value = previous;
  select.disabled = !items.length;
}
function emptyTable(id, columns, message, link) {
  const cell = node("td", message, "empty-cell");
  cell.colSpan = columns;
  if (link) {
    const a = node("a", link.text);
    a.href = link.href;
    cell.append(a);
  }
  const row = node("tr");
  row.append(cell);
  document.querySelector(`#${id} tbody`).replaceChildren(row);
}
function badge(state) {
  return node(
    "span",
    labels[state] || state,
    `badge state-${Object.hasOwn(labels, state) ? state : "unknown"}`,
  );
}
function money(cents) {
  return (cents / 100).toLocaleString("cs-CZ", {
    style: "currency",
    currency: "CZK",
    maximumFractionDigits: 2,
  });
}
function date(value) {
  return new Date(value).toLocaleString("cs-CZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function guest(id) {
  return users.find((user) => user.id === id);
}
function actionButton(text, action, id, kind = "reservation", danger = false) {
  const button = node(
    "button",
    text,
    `small ${danger ? "danger" : "secondary"}`,
  );
  button.type = "button";
  button.dataset.action = action;
  button.dataset.id = id;
  button.dataset.kind = kind;
  return button;
}
function updateControls() {
  const disable = (button, condition) => {
    button.disabled = !!condition || button.dataset.busy === "true";
  };
  disable(
    $("reservation-form").querySelector("button"),
    !users.length || !resources.length,
  );
  disable($("availability-form").querySelector("button"), !resources.length);
  disable($("refresh-reservations"), !resources.length || reservationLoading);
  disable($("refresh-tab"), !$("order-reservation").value || orderLoading);
  const selected = orderReservations.find(
    (r) => r.id === $("order-reservation").value,
  );
  const now = Date.now();
  const open =
    selected?.state === "CONFIRMED" &&
    now >= new Date(selected.startsAt).getTime() &&
    now < new Date(selected.endsAt).getTime();
  disable(
    $("place-order"),
    !open || !selectedLines().length || orderLoading || orderBusy,
  );
  $("ordering-hint").textContent = !selected
    ? "Vyberte stůl s rezervací. Novou návštěvu vytvoříte v sekci Rezervace."
    : open
      ? "Návštěva právě probíhá. Vyberte jídlo a pití a odešlete objednávku."
      : "Objednávat lze pouze v čase potvrzené rezervace. Účet si můžete prohlédnout kdykoliv.";
}
async function loadUsers() {
  users = await request("/users");
  const list = $("user-list");
  list.replaceChildren();
  for (const user of users) {
    const row = node("li"),
      info = node("span", user.name);
    info.append(node("small", user.email));
    row.append(
      node("span", user.name.slice(0, 2).toUpperCase(), "avatar"),
      info,
    );
    list.append(row);
  }
  if (!users.length)
    list.append(node("li", "Zatím žádní hosté. Přidejte prvního hosta výše."));
  $("user-count").textContent = `${users.length} hostů`;
  fillSelect(
    $("reservation-user"),
    users,
    (u) => `${u.name} · ${u.email}`,
    "Nejprve přidejte hosta",
  );
  renderReservations();
  if (orderReservations.length)
    fillSelect(
      $("order-reservation"),
      orderReservations,
      (r) =>
        `${guest(r.userId)?.name || "Host"} · ${date(r.startsAt)} · ${labels[r.state] || r.state}`,
    );
  updateControls();
}
async function loadResources() {
  resources = await request("/resources");
  const list = $("resource-list");
  list.replaceChildren();
  for (const resource of resources) {
    const row = node("li"),
      info = node("span", resource.name);
    info.append(
      node(
        "small",
        `${resource.capacity} míst${resource.requiresApproval ? " · schválení obsluhou" : " · přímé potvrzení"}`,
      ),
    );
    row.append(node("span", "▦", "avatar"), info);
    list.append(row);
  }
  if (!resources.length)
    list.append(node("li", "Zatím žádné stoly. Přidejte první stůl výše."));
  $("resource-count").textContent = `${resources.length} stolů`;
  for (const id of [
    "reservation-resource",
    "availability-resource",
    "reservations-resource",
    "orders-resource",
  ]) {
    fillSelect(
      $(id),
      resources,
      (r) =>
        `${r.name} · ${r.capacity} míst${r.requiresApproval ? " · schválení" : ""}`,
      "Nejprve přidejte stůl",
    );
  }
  updateControls();
  await Promise.all([loadReservations(), loadOrderReservations()]);
}
function renderReservations() {
  if (reservationError) {
    for (const id of [
      "stat-total",
      "stat-confirmed",
      "stat-pending",
      "stat-capacity",
    ])
      $(id).textContent = "—";
    emptyTable("reservation-table", 4, reservationError);
    $("reservation-count").textContent =
      "Načtení selhalo. Zkuste přehled obnovit.";
    return;
  }
  const resource = resources.find(
    (r) => r.id === $("reservations-resource").value,
  );
  $("stat-total").textContent = reservationLoading ? "—" : reservations.length;
  $("stat-confirmed").textContent = reservationLoading
    ? "—"
    : reservations.filter((r) => r.state === "CONFIRMED").length;
  $("stat-pending").textContent = reservationLoading
    ? "—"
    : reservations.filter((r) => r.state === "PENDING_APPROVAL").length;
  $("stat-capacity").textContent = resource?.capacity ?? "—";
  if (reservationLoading) {
    emptyTable("reservation-table", 4, "Načítání rezervací…");
    return;
  }
  const search = $("reservation-search")
    .value.trim()
    .toLocaleLowerCase("cs-CZ");
  const filter = $("reservation-filter").value;
  const visible = reservations.filter((r) => {
    const user = guest(r.userId);
    return (
      (!filter || r.state === filter) &&
      `${user?.name || ""} ${user?.email || ""}`
        .toLocaleLowerCase("cs-CZ")
        .includes(search)
    );
  });
  $("reservation-count").textContent =
    `Zobrazeno ${visible.length} z ${reservations.length} rezervací · všechny termíny vybraného stolu`;
  const tbody = document.querySelector("#reservation-table tbody");
  tbody.replaceChildren();
  if (!visible.length) {
    emptyTable(
      "reservation-table",
      4,
      !resources.length
        ? "Nejprve připravte stoly a hosty."
        : reservations.length
          ? "Žádná rezervace neodpovídá vašemu hledání."
          : "U tohoto stolu zatím není žádná rezervace.",
      !resources.length || !users.length
        ? { text: "Přejít na hosty a stoly →", href: "#manage" }
        : undefined,
    );
    return;
  }
  for (const r of visible) {
    const row = node("tr"),
      user = guest(r.userId),
      host = node("td", user?.name || "Neznámý host");
    host.append(node("small", user?.email || ""));
    const term = node("td", date(r.startsAt));
    term.append(node("small", `Do ${date(r.endsAt)}`));
    const state = node("td");
    state.append(badge(r.state));
    const cell = node("td"),
      actions = node("div", undefined, "actions");
    if (r.state === "DRAFT")
      actions.append(actionButton("Potvrdit", "confirm", r.id));
    if (r.state === "PENDING_APPROVAL")
      actions.append(
        actionButton("Schválit", "approve", r.id),
        actionButton("Zamítnout", "reject", r.id, "reservation", true),
      );
    if (
      ["DRAFT", "CONFIRMED", "PENDING_APPROVAL"].includes(r.state) &&
      Date.now() < new Date(r.startsAt).getTime()
    )
      actions.append(
        actionButton("Zrušit", "cancel", r.id, "reservation", true),
      );
    if (r.state === "CONFIRMED")
      actions.append(actionButton("Účet →", "tab", r.id));
    if (!actions.childElementCount)
      actions.append(node("span", "Bez dalších akcí", "muted"));
    cell.append(actions);
    row.append(host, term, state, cell);
    tbody.append(row);
  }
}
async function loadReservations() {
  const version = ++reservationVersion,
    id = $("reservations-resource").value;
  reservations = [];
  reservationError = "";
  reservationLoading = !!id;
  renderReservations();
  updateControls();
  try {
    const body = id
      ? await request(`/resources/${encodeURIComponent(id)}/reservations`)
      : [];
    if (version === reservationVersion) reservations = body;
  } catch (error) {
    if (version === reservationVersion) {
      reservationError =
        "Rezervace se nepodařilo načíst. Zkuste přehled obnovit.";
      throw error;
    }
  } finally {
    if (version === reservationVersion) {
      reservationLoading = false;
      renderReservations();
      updateControls();
    }
  }
}
function resetBill(message = "Vyberte rezervaci pro zobrazení účtu.") {
  ++tabVersion;
  for (const id of ["tab-unpaid", "tab-paid", "tab-total"])
    $(id).textContent = "—";
  emptyTable("tab-table", 3, message);
}
async function loadOrderReservations(preferred) {
  const version = ++orderVersion,
    id = $("orders-resource").value;
  orderReservations = [];
  orderLoading = true;
  fillSelect($("order-reservation"), [], () => "", "Načítání rezervací…");
  resetBill();
  updateControls();
  try {
    const body = id
      ? await request(`/resources/${encodeURIComponent(id)}/reservations`)
      : [];
    if (version !== orderVersion) return;
    orderReservations = body;
    fillSelect(
      $("order-reservation"),
      body,
      (r) =>
        `${guest(r.userId)?.name || "Host"} · ${date(r.startsAt)} · ${labels[r.state] || r.state}`,
      "Tento stůl nemá rezervace",
    );
    if (body.some((r) => r.id === preferred))
      $("order-reservation").value = preferred;
    await loadTab();
  } finally {
    if (version === orderVersion) {
      orderLoading = false;
      updateControls();
    }
  }
}
async function loadMenu() {
  menuItems = await request("/menu-items");
  const list = $("menu-list");
  list.replaceChildren();
  for (const [category, title] of [
    ["FOOD", "Něco k zakousnutí"],
    ["DRINK", "Na zdraví"],
  ]) {
    const items = menuItems.filter((item) => item.category === category);
    if (items.length) list.append(node("h3", title));
    for (const item of items) {
      const row = node(
          "label",
          undefined,
          `menu-row${item.available ? "" : " sold-out"}`,
        ),
        info = node("span", item.name);
      info.append(
        node(
          "small",
          `${money(item.priceCents)}${item.available ? "" : " · momentálně nedostupné"}`,
        ),
      );
      const input = node("input");
      input.type = "number";
      input.min = "0";
      input.step = "1";
      input.value = "0";
      input.dataset.menuItem = item.id;
      input.disabled = !item.available;
      input.setAttribute("aria-label", `Počet: ${item.name}`);
      row.append(info, input);
      list.append(row);
    }
  }
  if (!menuItems.length)
    list.append(node("p", "Jídelní lístek je zatím prázdný.", "muted"));
  updateCart();
}
function selectedLines() {
  return [...document.querySelectorAll("[data-menu-item]")]
    .filter((input) => !input.disabled)
    .map((input) => ({
      menuItemId: input.dataset.menuItem,
      quantity: Number(input.value),
    }))
    .filter((line) => Number.isInteger(line.quantity) && line.quantity > 0);
}
function updateCart() {
  const total = selectedLines().reduce(
    (sum, line) =>
      sum +
      line.quantity *
        (menuItems.find((item) => item.id === line.menuItemId)?.priceCents ||
          0),
    0,
  );
  $("cart-total").textContent = money(total);
  updateControls();
}
async function loadTab() {
  const id = $("order-reservation").value;
  resetBill(id ? "Načítání účtu…" : undefined);
  const version = tabVersion;
  if (!id) return;
  try {
    const body = await request(`/reservations/${encodeURIComponent(id)}/tab`);
    if (version !== tabVersion || id !== $("order-reservation").value) return;
    $("tab-unpaid").textContent = money(body.unpaidCents);
    $("tab-paid").textContent = money(body.paidCents);
    $("tab-total").textContent = money(body.totalCents);
    const tbody = document.querySelector("#tab-table tbody");
    tbody.replaceChildren();
    if (!body.orders.length) {
      emptyTable(
        "tab-table",
        3,
        "Na tomto účtu zatím nejsou žádné objednávky.",
      );
      return;
    }
    for (const order of body.orders) {
      const row = node("tr"),
        items = node("td");
      for (const line of order.lines)
        items.append(node("div", `${line.quantity}× ${line.name}`));
      items.append(node("small", `Objednávka ${order.id.slice(0, 8)}`));
      const state = node("td"),
        actions = node("div", undefined, "actions");
      state.append(badge(order.state));
      if (order.state === "PLACED")
        actions.append(
          actionButton("Označit jako podané", "serve", order.id, "order"),
        );
      if (order.state === "SERVED")
        actions.append(
          actionButton("Označit jako zaplacené", "pay", order.id, "order"),
        );
      state.append(actions);
      row.append(items, node("td", money(order.totalCents)), state);
      tbody.append(row);
    }
  } catch (error) {
    if (version === tabVersion) {
      emptyTable(
        "tab-table",
        3,
        "Účet se nepodařilo načíst. Zkuste jej obnovit.",
      );
      throw error;
    }
  }
}
function interval(form, startName, endName) {
  const start = new Date(form.get(startName)),
    end = new Date(form.get(endName));
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end <= start
  )
    throw new Error("Konec návštěvy musí být později než její začátek.");
  return [start.toISOString(), end.toISOString()];
}
function onSubmit(id, task) {
  $(id).addEventListener("submit", (event) => {
    event.preventDefault();
    void run(
      () => task(new FormData(event.target), event.target),
      event.submitter,
    );
  });
}
onSubmit("user-form", async (form, element) => {
  const name = form.get("name").trim();
  if (!name) throw new Error("Vyplňte jméno hosta.");
  await request("/users", { name, email: form.get("email").trim() });
  element.reset();
  await loadUsers();
  notice("Host byl přidán. Nyní mu můžete vytvořit rezervaci.");
});
onSubmit("resource-form", async (form, element) => {
  const name = form.get("name").trim();
  if (!name) throw new Error("Vyplňte název stolu.");
  await request("/resources", {
    name,
    capacity: Number(form.get("capacity")),
    requiresApproval: form.has("requiresApproval"),
  });
  element.reset();
  await loadResources();
  notice("Stůl byl přidán a je připraven pro rezervace.");
});
onSubmit("reservation-form", async (form) => {
  const [startsAt, endsAt] = interval(form, "startsAt", "endsAt");
  await request("/reservations", {
    resourceId: form.get("resourceId"),
    userId: form.get("userId"),
    startsAt,
    endsAt,
  });
  $("reservations-resource").value = form.get("resourceId");
  $("reservation-search").value = "";
  $("reservation-filter").value = "";
  await loadReservations();
  await loadOrderReservations($("order-reservation").value);
  notice(
    "Rezervace byla vytvořena. Dokončete ji tlačítkem Potvrdit v přehledu.",
  );
});
onSubmit("availability-form", async (form) => {
  $("availability-result").textContent = "Ověřování dostupnosti…";
  delete $("availability-result").dataset.tone;
  try {
    const [start, end] = interval(form, "start", "end");
    const body = await request(
      `/resources/${encodeURIComponent(form.get("resourceId"))}/availability?${new URLSearchParams({ start, end })}`,
    );
    $("availability-result").textContent = body.available
      ? "Stůl je v tomto termínu volný. Můžete vytvořit rezervaci."
      : "Stůl je v tomto termínu obsazený. Zvolte jiný termín nebo stůl.";
    $("availability-result").dataset.tone = body.available
      ? "success"
      : "error";
  } catch (error) {
    $("availability-result").textContent = error.message;
    $("availability-result").dataset.tone = "error";
    throw error;
  }
});
onSubmit("order-form", async () => {
  const id = $("order-reservation").value,
    items = selectedLines();
  if (!id || !items.length)
    throw new Error("Vyberte rezervaci a alespoň jednu položku.");
  orderBusy = true;
  try {
    await request(`/reservations/${encodeURIComponent(id)}/orders`, { items });
    if (id === $("order-reservation").value)
      document.querySelectorAll("[data-menu-item]").forEach((input) => {
        input.value = "0";
      });
    updateCart();
    await loadTab();
    notice("Objednávka byla přijata a přidána na účet.");
  } finally {
    orderBusy = false;
  }
});
document
  .querySelector("#reservation-table tbody")
  .addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    void run(async () => {
      const { action, id } = button.dataset;
      if (action === "tab") {
        $("orders-resource").value = $("reservations-resource").value;
        location.hash = "orders";
        await loadOrderReservations(id);
        return;
      }
      const result = await request(
        `/reservations/${encodeURIComponent(id)}/${action}`,
        {},
      );
      await loadReservations();
      await loadOrderReservations($("order-reservation").value);
      notice(`Rezervace: ${labels[result.state] || result.state}.`);
    }, button);
  });
document
  .querySelector("#tab-table tbody")
  .addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    void run(async () => {
      await request(
        `/orders/${encodeURIComponent(button.dataset.id)}/${button.dataset.action}`,
        {},
      );
      await loadTab();
      notice("Stav objednávky byl aktualizován.");
    }, button);
  });
$("refresh-reservations").addEventListener("click", (event) => {
  void run(loadReservations, event.currentTarget);
});
$("refresh-data").addEventListener("click", (event) => {
  void run(async () => {
    const results = await Promise.allSettled([
      loadUsers(),
      loadResources(),
      loadMenu(),
    ]);
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
    notice("Data byla aktualizována.");
  }, event.currentTarget);
});
$("reservations-resource").addEventListener("change", () => {
  void run(loadReservations);
});
$("orders-resource").addEventListener("change", () => {
  void run(() => loadOrderReservations());
});
$("order-reservation").addEventListener("change", () => {
  updateControls();
  void run(loadTab);
});
$("refresh-tab").addEventListener("click", (event) => {
  void run(loadTab, event.currentTarget);
});
$("reservation-search").addEventListener("input", renderReservations);
$("reservation-filter").addEventListener("change", renderReservations);
$("menu-list").addEventListener("input", updateCart);
$("availability-form").addEventListener("input", () => {
  $("availability-result").textContent = "Vyberte stůl a termín návštěvy.";
  delete $("availability-result").dataset.tone;
});
function route() {
  if (location.hash === "#main") {
    $("main").focus();
    return;
  }
  const hash = location.hash.slice(1),
    view = ["reservations", "orders", "manage"].includes(hash)
      ? hash
      : "reservations";
  for (const section of document.querySelectorAll(".view"))
    section.hidden = section.id !== view;
  for (const link of document.querySelectorAll(".nav-link")) {
    const active = link.hash === `#${view}`;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  const title = {
    reservations: "Rezervace",
    orders: "Objednávky a účet",
    manage: "Hosté a stoly",
  }[view];
  $("page-label").textContent = title;
  document.title = `Hospoda Devs · ${title}`;
  if (hash === "reservation-form") {
    $("reservation-form").scrollIntoView({ block: "center" });
    $("reservation-resource").focus();
  }
}
window.addEventListener("hashchange", route);
const now = new Date();
$("today").dateTime = now.toISOString();
$("today").textContent = now.toLocaleDateString("cs-CZ", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
function localDate(value) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
const start = new Date(now.getTime() + 3600000);
start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
for (const name of ["startsAt", "start"])
  document.querySelector(`input[name="${name}"]`).value = localDate(start);
for (const name of ["endsAt", "end"])
  document.querySelector(`input[name="${name}"]`).value = localDate(
    new Date(start.getTime() + 2 * 3600000),
  );
route();
updateControls();
void Promise.all([run(loadUsers), run(loadResources), run(loadMenu)]);
// Keep time-dependent order controls current while the page stays open.
setInterval(updateControls, 30000);

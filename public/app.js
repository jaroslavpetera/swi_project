const api = {
  async get(url) {
    const res = await fetch(url);
    return { ok: res.ok, status: res.status, body: await res.json() };
  },
  async post(url, data) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return { ok: res.ok, status: res.status, body: await res.json() };
  },
};

let users = [];
let resources = [];

function fillSelect(select, items, labelFn) {
  const previous = select.value;
  select.innerHTML = "";
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = labelFn(item);
    select.appendChild(option);
  }
  if ([...select.options].some((o) => o.value === previous)) {
    select.value = previous;
  }
}

async function loadUsers() {
  const { body } = await api.get("/users");
  users = body;
  document.getElementById("user-list").innerHTML = users
    .map((u) => `<li>${u.name} — ${u.email} <code>${u.id}</code></li>`)
    .join("");
  fillSelect(document.getElementById("reservation-user"), users, (u) => `${u.name} (${u.email})`);
}

async function loadResources() {
  const { body } = await api.get("/resources");
  resources = body;
  document.getElementById("resource-list").innerHTML = resources
    .map((r) => `<li>${r.name} — kapacita ${r.capacity} <code>${r.id}</code></li>`)
    .join("");
  const labelFn = (r) => `${r.name} (kap. ${r.capacity})`;
  fillSelect(document.getElementById("reservation-resource"), resources, labelFn);
  fillSelect(document.getElementById("availability-resource"), resources, labelFn);
  fillSelect(document.getElementById("reservations-resource"), resources, labelFn);
}

function toIsoOrEmpty(localDatetimeValue) {
  return localDatetimeValue ? new Date(localDatetimeValue).toISOString() : "";
}

document.getElementById("user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const { ok, body } = await api.post("/users", {
    name: form.get("name"),
    email: form.get("email"),
  });
  if (ok) {
    e.target.reset();
    await loadUsers();
  } else {
    alert("Chyba: " + JSON.stringify(body));
  }
});

document.getElementById("resource-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const { ok, body } = await api.post("/resources", {
    name: form.get("name"),
    capacity: Number(form.get("capacity")),
  });
  if (ok) {
    e.target.reset();
    await loadResources();
  } else {
    alert("Chyba: " + JSON.stringify(body));
  }
});

document.getElementById("reservation-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const { ok, status, body } = await api.post("/reservations", {
    resourceId: form.get("resourceId"),
    userId: form.get("userId"),
    startsAt: toIsoOrEmpty(form.get("startsAt")),
    endsAt: toIsoOrEmpty(form.get("endsAt")),
  });
  document.getElementById("reservation-result").textContent = `HTTP ${status}\n${JSON.stringify(body, null, 2)}`;
  if (ok) await loadReservations();
});

document.getElementById("availability-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const resourceId = form.get("resourceId");
  const start = toIsoOrEmpty(form.get("start"));
  const end = toIsoOrEmpty(form.get("end"));
  const { status, body } = await api.get(
    `/resources/${resourceId}/availability?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
  );
  document.getElementById("availability-result").textContent = `HTTP ${status}\n${JSON.stringify(body, null, 2)}`;
});

async function loadReservations() {
  const resourceId = document.getElementById("reservations-resource").value;
  if (!resourceId) return;
  const { body } = await api.get(`/resources/${resourceId}/reservations`);
  const tbody = document.querySelector("#reservation-table tbody");
  tbody.innerHTML = body
    .map(
      (r) => `
      <tr>
        <td>${new Date(r.startsAt).toLocaleString()}</td>
        <td>${new Date(r.endsAt).toLocaleString()}</td>
        <td class="state-${r.state}">${r.state}</td>
        <td>
          <button data-action="confirm" data-id="${r.id}" ${r.state !== "DRAFT" ? "disabled" : ""}>Confirm</button>
          <button data-action="cancel" data-id="${r.id}" ${r.state === "CANCELLED" ? "disabled" : ""}>Cancel</button>
        </td>
      </tr>`
    )
    .join("");
}

document.querySelector("#reservation-table tbody").addEventListener("click", async (e) => {
  const button = e.target.closest("button[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  const { ok, body } = await api.post(`/reservations/${id}/${action}`, {});
  if (!ok) alert("Chyba: " + JSON.stringify(body));
  await loadReservations();
});

document.getElementById("refresh-reservations").addEventListener("click", loadReservations);
document.getElementById("reservations-resource").addEventListener("change", loadReservations);

(async function init() {
  await Promise.all([loadUsers(), loadResources()]);
})();

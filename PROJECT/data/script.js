let db = null;

// Wait for sql.js to finish loading the WASM
async function initSQLite() {
  try {
    // <-- This is the correct way (SQL is the global provided by sql-wasm.min.js)
    const SQL = await initSqlJs({
      locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`
    });
    db = new SQL.Database();
    console.log("SQLite ready!");
    document.getElementById("loadStatus").textContent = "SQLite ready – click Load Data";
  } catch (err) {
    console.error(err);
    document.getElementById("loadStatus").textContent = "Failed to load SQLite: " + err.message;
  }
}

// Load all CSVs and create tables
async function loadCSVs() {
  if (!db) return alert("SQLite not ready yet");

  const tables = ["cities","restaurants","employees","customers","foods","orders"];

  for (const table of tables) {
    try {
      const resp = await fetch(`${table}.csv`);
      if (!resp.ok) throw new Error("404");
      const csvText = await resp.text();

      const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
      if (parsed.errors.length) throw parsed.errors[0];

      const rows = parsed.data;
      if (rows.length === 0) continue;

      const cols = Object.keys(rows[0]);
      const colDefs = cols.map(c => `[${c}] TEXT`).join(", ");
      db.run(`CREATE TABLE IF NOT EXISTS [${table}] (${colDefs})`);

      const placeholders = cols.map(() => "?").join(",");
      const stmt = db.prepare(`INSERT INTO [${table}] VALUES (${placeholders})`);

      for (const row of rows) {
        stmt.run(cols.map(c => row[c] ?? null));
      }
      stmt.free();
    } catch (e) {
      document.getElementById("loadStatus").textContent = `Failed loading ${table}.csv`;
      console.error(e);
      return;
    }
  }
  document.getElementById("loadStatus").textContent = "All data loaded!";
}

// Preset queries (SQLite syntax)
const presetQueries = {
  favoriteDishMale: `
    SELECT 
      ROW_NUMBER() OVER (ORDER BY orders_count DESC, favorite_dish ASC) AS '',
      favorite_dish,
      orders_count
    FROM (
      SELECT f.name AS favorite_dish, COUNT(*) AS orders_count
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      JOIN foods f ON o.food_id = f.id
      WHERE c.gender = 'male'
      GROUP BY f.name
    ) sub
    ORDER BY ''
    LIMIT 5;`,

  mostSeniorsCity: `
    SELECT 
      ROW_NUMBER() OVER (ORDER BY senior_count DESC, city_name ASC) AS '',
      city_name,
      senior_count
    FROM (
      SELECT ci.name AS city_name, COUNT(DISTINCT o.customer_id) AS senior_count
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      JOIN restaurants r ON o.restaurant_id = r.id
      JOIN cities ci ON r.city_id = ci.id
      WHERE c.age >= 65
      GROUP BY ci.name
    ) sub
    ORDER BY ''
    LIMIT 5;`,

  mostPopularLA: `
    SELECT 
      ROW_NUMBER() OVER (ORDER BY orders_count DESC, franchise ASC) AS '',
      franchise,
      orders_count
    FROM (
      SELECT r.franchise, COUNT(*) AS orders_count
      FROM orders o
      JOIN restaurants r ON o.restaurant_id = r.id
      JOIN cities c ON r.city_id = c.id
      WHERE c.state = 'LA'
      GROUP BY r.franchise
    ) sub
    ORDER BY ''
    LIMIT 5;`,

  maxSpendDay: `
  WITH daily_spend AS (
    SELECT
      c.id          AS customer_id,
      c.name        AS customer_name,
      o.restaurant_id,
      r.name        AS restaurant_name,
      o.order_date,
      SUM(f.price)  AS total_spent,
      ROW_NUMBER() OVER (
        PARTITION BY c.id 
        ORDER BY SUM(f.price) DESC, o.order_date DESC, o.restaurant_id ASC
      ) AS rn
    FROM orders o
    JOIN customers   c ON o.customer_id   = c.id
    JOIN foods       f ON o.food_id       = f.id
    JOIN restaurants r ON o.restaurant_id = r.id
    GROUP BY c.id, c.name, o.restaurant_id, r.name, o.order_date
  )
  SELECT 
    ROW_NUMBER() OVER (ORDER BY total_spent DESC, customer_id ASC) AS '',
    customer_id,
    customer_name,
    restaurant_id,
    restaurant_name,
    order_date,
    total_spent
  FROM daily_spend
  WHERE rn = 1
  ORDER BY '';`,

  diffFavorites: `
    SELECT 
      ROW_NUMBER() OVER (ORDER BY r.name ASC, r.id ASC) AS '',
      r.id,
      r.name
    FROM (
      WITH customer_fav AS (
        SELECT o.restaurant_id, o.food_id, COUNT(*) AS cnt
        FROM orders o
        GROUP BY o.restaurant_id, o.food_id
      ),
      customer_top AS (
        SELECT restaurant_id, food_id
        FROM customer_fav cf
        WHERE cf.cnt = (
          SELECT MAX(cf2.cnt)
          FROM customer_fav cf2
          WHERE cf2.restaurant_id = cf.restaurant_id
        )
      ),
      employee_fav AS (
        SELECT e.restaurant_id, o.food_id, COUNT(*) AS cnt
        FROM employees e
        JOIN orders o ON e.restaurant_id = o.restaurant_id
        GROUP BY e.restaurant_id, o.food_id
      ),
      employee_top AS (
        SELECT restaurant_id, food_id
        FROM employee_fav ef
        WHERE ef.cnt = (
          SELECT MAX(ef2.cnt)
          FROM employee_fav ef2
          WHERE ef2.restaurant_id = ef.restaurant_id
        )
      )
      SELECT DISTINCT r.id, r.name
      FROM restaurants r
      JOIN customer_top ct ON r.id = ct.restaurant_id
      JOIN employee_top et ON r.id = et.restaurant_id
      WHERE ct.food_id <> et.food_id
    ) sub
    JOIN restaurants r ON sub.id = r.id
    ORDER BY '';`,

  busyRestaurants: `
    SELECT 
      ROW_NUMBER() OVER (ORDER BY TotalCustomers DESC, Restaurant ASC, Month ASC) AS '',
      Restaurant,
      Month,
      TotalCustomers
    FROM (
      SELECT
        r.name AS Restaurant,
        printf('%04d-%02d',
          CAST(substr(o.order_date, -4) AS INTEGER),
          CAST(substr(o.order_date, 1, instr(o.order_date, '/') - 1) AS INTEGER)
        ) AS Month,
        COUNT(*) AS TotalCustomers
      FROM orders o
      JOIN restaurants r ON o.restaurant_id = r.id
      GROUP BY r.name, Month
    ) sub
    ORDER BY ''
    LIMIT 5;`
};

// Run a query and display JSON result
function runQuery(sql) {
  if (!db) return (document.getElementById("output").innerHTML = "DB not ready");
  try {
    const res = db.exec(sql);
    if (!res[0] || res[0].values.length === 0) {
      document.getElementById("output").innerHTML = "<p>No results</p>";
      return;
    }
    const cols = res[0].columns;
    const rows = res[0].values;

    let html = `<table border="1" style="border-collapse:collapse; width:100%; margin-top:10px;">
      <thead><tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr></thead>
      <tbody>`;
    rows.forEach(row => {
      html += "<tr>" + row.map(cell => `<td>${cell ?? ""}</td>`).join("") + "</tr>";
    });
    html += "</tbody></table>";
    document.getElementById("output").innerHTML = html;
  } catch (e) {
    document.getElementById("output").innerHTML = `<p style="color:red;">Error: ${e.message}</p>`;
  }
}

// Wire everything up
document.addEventListener("DOMContentLoaded", () => {
  initSQLite();

  document.getElementById("loadData").onclick = loadCSVs;

  document.querySelectorAll(".query-btn").forEach(btn => {
    btn.onclick = () => runQuery(presetQueries[btn.dataset.query]);
  });

  document.getElementById("runSQL").onclick = () => {
    const sql = document.getElementById("sqlBox").value;
    runQuery(sql);
  };
});
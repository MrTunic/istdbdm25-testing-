import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@latest/dist/duckdb-wasm.mjs";
let db;

// ----------------------------
// Initialize DuckDB
// ----------------------------
async function initDuckDB() {
  const bundle = await duckdb.selectBundle({
    mvp: {
      mainModule: "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/dist/duckdb-mvp.wasm",
      mainWorker: "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/dist/duckdb-browser-mvp.worker.js"
    }
  });

  const worker = new Worker(bundle.mainWorker);
  const logger = new duckdb.ConsoleLogger();

  const dbInstance = new duckdb.AsyncDuckDB(logger, worker);
  await dbInstance.instantiate(bundle.mainModule);
  return dbInstance;
}

// ----------------------------
// Load CSVs into DuckDB tables
// ----------------------------
async function loadCSVs() {
  const tables = [
    "city",
    "restaurants",
    "employees",
    "customers",
    "food",
    "orders"
  ];

  for (const t of tables) {
    await db.run(`
      CREATE TABLE ${t} AS
      SELECT * FROM read_csv_auto('PROJECT/data/${t}.csv');
    `);
  }
}

// ----------------------------
// PRESET QUERIES
// ----------------------------
const presetQueries = {
  favoriteDishMale: `
    SELECT f.Name, COUNT(*) AS Total
    FROM orders o
    JOIN customers c ON o.CustomerID = c.CustomerID
    JOIN food f ON o.FoodID = f.FoodID
    WHERE c.Gender = 'Male'
    GROUP BY f.Name
    ORDER BY Total DESC
    LIMIT 1;
  `,

  mostSeniorsCity: `
    SELECT ci.Name AS CityName, COUNT(*) AS Seniors
    FROM customers c
    JOIN orders o ON c.CustomerID = o.CustomerID
    JOIN restaurants r ON o.RestaurantID = r.RestaurantID
    JOIN city ci ON r.CityID = ci.CityID
    WHERE c.Age >= 65
    GROUP BY ci.Name
    ORDER BY Seniors DESC
    LIMIT 1;
  `,

  mostPopularLA: `
    SELECT Franchise, COUNT(*) AS CountFranchise
    FROM restaurants r
    JOIN city c ON r.CityID = c.CityID
    WHERE c.State = 'LA'
    GROUP BY Franchise
    ORDER BY CountFranchise DESC
    LIMIT 1;
  `,

  maxSpendDay: `
    SELECT CustomerID, OrderDate, SUM(Price) AS Total
    FROM orders o
    JOIN food f ON o.FoodID = f.FoodID
    GROUP BY CustomerID, OrderDate
    ORDER BY Total DESC;
  `,

  diffFavorites: `
    SELECT DISTINCT r.RestaurantID, r.Name
    FROM restaurants r
    JOIN employees e ON r.RestaurantID = e.RestaurantID
    JOIN orders o ON r.RestaurantID = o.RestaurantID
    JOIN food f1 ON e.FavoriteFoodID = f1.FoodID
    JOIN food f2 ON o.FoodID = f2.FoodID
    WHERE f1.FoodID != f2.FoodID;
  `,

  busyRestaurants: `
    SELECT r.Name, DATE_TRUNC('month', OrderDate) AS Month, COUNT(*) AS TotalCustomers
    FROM orders o
    JOIN restaurants r ON o.RestaurantID = r.RestaurantID
    GROUP BY r.Name, Month
    ORDER BY TotalCustomers DESC;
  `
};

// ----------------------------
// Page Logic
// ----------------------------
document.addEventListener("DOMContentLoaded", async () => {
  db = await initDuckDB();

  document.getElementById("loadData").onclick = async () => {
    await loadCSVs();
    document.getElementById("loadStatus").textContent = "✔ Data Loaded Successfully!";
  };

  // Run preset queries
  document.querySelectorAll(".query-btn").forEach(btn => {
    btn.onclick = async () => {
      const query = presetQueries[btn.dataset.query];
      const result = await db.query(query);
      document.getElementById("output").textContent =
        JSON.stringify(result.toArray(), null, 2);
    };
  });

  // Run custom SQL
  document.getElementById("runSQL").onclick = async () => {
    const sql = document.getElementById("sqlBox").value;
    const result = await db.query(sql);
    document.getElementById("output").textContent =
      JSON.stringify(result.toArray(), null, 2);
  };
});

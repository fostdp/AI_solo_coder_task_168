const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'workshop.db');
const db = new sqlite3.Database(dbPath);

db.run = function(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.constructor.prototype.run.call(this, sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

db.get = function(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.constructor.prototype.get.call(this, sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

db.all = function(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.constructor.prototype.all.call(this, sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

module.exports = db;

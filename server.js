const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Serve static frontend files from the workspace root
app.use(express.static(__dirname));

let pool;

async function logSQL(connection, sqlText, status = 'SUCCESS', errorMsg = '') {
    const timestamp = new Date().toLocaleTimeString();
    try {
        await connection.query(
            'INSERT INTO sql_logs (timestamp, sql_text, status, error_msg) VALUES (?, ?, ?, ?)',
            [timestamp, sqlText, status, errorMsg || null]
        );
    } catch (err) {
        console.error('Failed to log SQL execution:', err);
    }
}

async function initializeDatabase() {
    // 1. Connect to MySQL server without database first
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '1289',
        multipleStatements: true
    });

    console.log('Connected to MySQL server. Setting up database...');

    // 2. Create database
    await connection.query('CREATE DATABASE IF NOT EXISTS banking_system;');
    await connection.end();

    // 3. Connect to the banking_system database with pool
    pool = mysql.createPool({
        host: 'localhost',
        user: 'root',
        password: '1289',
        database: 'banking_system',
        multipleStatements: true,
        connectionLimit: 10,
        decimalNumbers: true
    });

    // Check if tables already exist. If Customer exists, we assume database is initialized
    const conn = await pool.getConnection();
    try {
        const [tables] = await conn.query("SHOW TABLES LIKE 'Customer'");
        if (tables.length > 0) {
            console.log('Database already initialized.');
            return;
        }

        console.log('Initializing database schema...');

        // 4. Create Tables
        const schemaQueries = `
            CREATE TABLE IF NOT EXISTS Branch (
                branch_id INT PRIMARY KEY,
                branch_name VARCHAR(100) NOT NULL,
                location VARCHAR(100) NOT NULL
            );

            CREATE TABLE IF NOT EXISTS Customer (
                customer_id INT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                phone VARCHAR(15) UNIQUE NOT NULL,
                address VARCHAR(255) NOT NULL
            );

            CREATE TABLE IF NOT EXISTS Account (
                account_id INT PRIMARY KEY,
                customer_id INT,
                branch_id INT,
                account_type VARCHAR(20) NOT NULL,
                balance DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
                FOREIGN KEY (customer_id) REFERENCES Customer(customer_id) ON DELETE RESTRICT,
                FOREIGN KEY (branch_id) REFERENCES Branch(branch_id) ON DELETE RESTRICT
            );

            CREATE TABLE IF NOT EXISTS Transaction (
                transaction_id INT AUTO_INCREMENT PRIMARY KEY,
                account_id INT,
                transaction_type VARCHAR(20) NOT NULL,
                amount DECIMAL(15, 2) NOT NULL,
                transaction_date DATE NOT NULL,
                FOREIGN KEY (account_id) REFERENCES Account(account_id) ON DELETE RESTRICT
            );

            CREATE TABLE IF NOT EXISTS Loan (
                loan_id INT PRIMARY KEY,
                customer_id INT,
                amount DECIMAL(15, 2) NOT NULL,
                loan_type VARCHAR(50) NOT NULL,
                status VARCHAR(20) NOT NULL,
                FOREIGN KEY (customer_id) REFERENCES Customer(customer_id) ON DELETE RESTRICT
            );

            CREATE TABLE IF NOT EXISTS Employee (
                employee_id INT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                branch_id INT,
                role VARCHAR(50) NOT NULL,
                FOREIGN KEY (branch_id) REFERENCES Branch(branch_id) ON DELETE RESTRICT
            );

            CREATE TABLE IF NOT EXISTS sql_logs (
                log_id INT AUTO_INCREMENT PRIMARY KEY,
                timestamp VARCHAR(50) NOT NULL,
                sql_text TEXT NOT NULL,
                status VARCHAR(20) NOT NULL,
                error_msg TEXT
            );
        `;
        await conn.query(schemaQueries);
        await logSQL(conn, '-- Initializing database schema...');

        // 5. Seed Data (inserted before creating triggers so that the triggers do not overwrite the seeded balances)
        console.log('Seeding initial data...');
        const seedQueries = `
            INSERT INTO Branch (branch_id, branch_name, location) VALUES
            (101, 'Main Branch', 'Udupi'),
            (102, 'City Branch', 'Mangalore');

            INSERT INTO Customer (customer_id, name, phone, address) VALUES
            (1, 'Shraddha', '9876543210', 'Udupi'),
            (2, 'Amit', '9876501234', 'Mangalore'),
            (3, 'Riya', '9988776655', 'Bangalore'),
            (4, 'Kiran', '9123456780', 'Manipal');

            INSERT INTO Account (account_id, customer_id, branch_id, account_type, balance) VALUES
            (1001, 1, 101, 'Savings', 60000.00),
            (1002, 2, 102, 'Current', 40000.00),
            (1003, 3, 101, 'Savings', 80000.00);

            INSERT INTO Transaction (transaction_id, account_id, transaction_type, amount, transaction_date) VALUES
            (1, 1001, 'Deposit', 10000.00, '2026-05-01'),
            (2, 1001, 'Withdrawal', 5000.00, '2026-05-05'),
            (3, 1003, 'Deposit', 20000.00, '2026-05-08');

            INSERT INTO Loan (loan_id, customer_id, amount, loan_type, status) VALUES
            (201, 1, 500000.00, 'Home Loan', 'Approved'),
            (202, 2, 100000.00, 'Education Loan', 'Pending');

            INSERT INTO Employee (employee_id, name, branch_id, role) VALUES
            (301, 'Rahul', 101, 'Manager'),
            (302, 'Sneha', 102, 'Cashier');
        `;
        await conn.query(seedQueries);
        await logSQL(conn, "INSERT INTO Branch VALUES (101, 'Main Branch', 'Udupi');\nINSERT INTO Branch VALUES (102, 'City Branch', 'Mangalore');\nINSERT INTO Customer VALUES (1, 'Shraddha', '9876543210', 'Udupi');\n-- (and other seed inserts)");

        // 6. Create Triggers & Procedures
        console.log('Creating triggers and stored procedures...');
        
        await conn.query(`
            DROP TRIGGER IF EXISTS MinimumBalanceCheck;
        `);
        await conn.query(`
            CREATE TRIGGER MinimumBalanceCheck
            BEFORE INSERT ON Transaction
            FOR EACH ROW
            BEGIN
                DECLARE current_balance DECIMAL(15, 2);
                IF NEW.transaction_type = 'Withdrawal' THEN
                    SELECT balance INTO current_balance FROM Account WHERE account_id = NEW.account_id;
                    IF current_balance - NEW.amount < 1000 THEN
                        SIGNAL SQLSTATE '45000'
                        SET MESSAGE_TEXT = 'Minimum balance should be maintained';
                    END IF;
                END IF;
            END;
        `);

        await conn.query(`
            DROP TRIGGER IF EXISTS UpdateBalanceAfterTransaction;
        `);
        await conn.query(`
            CREATE TRIGGER UpdateBalanceAfterTransaction
            AFTER INSERT ON Transaction
            FOR EACH ROW
            BEGIN
                IF NEW.transaction_type = 'Deposit' THEN
                    UPDATE Account SET balance = balance + NEW.amount WHERE account_id = NEW.account_id;
                ELSEIF NEW.transaction_type = 'Withdrawal' THEN
                    UPDATE Account SET balance = balance - NEW.amount WHERE account_id = NEW.account_id;
                END IF;
            END;
        `);

        await conn.query(`
            DROP PROCEDURE IF EXISTS TransferFunds;
        `);
        await conn.query(`
            CREATE PROCEDURE TransferFunds(
                IN from_acc INT,
                IN to_acc INT,
                IN amount DECIMAL(15, 2)
            )
            BEGIN
                DECLARE source_balance DECIMAL(15, 2);
                
                IF from_acc = to_acc THEN
                    SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Source and destination accounts must be different.';
                END IF;

                SELECT balance INTO source_balance FROM Account WHERE account_id = from_acc;
                IF source_balance IS NULL THEN
                    SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Source Account does not exist.';
                END IF;

                IF NOT EXISTS (SELECT 1 FROM Account WHERE account_id = to_acc) THEN
                    SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Destination Account does not exist.';
                END IF;

                IF amount <= 0 THEN
                    SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Transfer amount must be greater than zero.';
                END IF;

                IF source_balance - amount < 1000 THEN
                    SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Insufficient funds: Transfer would drop source account below the minimum balance of 1000.';
                END IF;

                START TRANSACTION;
                
                INSERT INTO Transaction (account_id, transaction_type, amount, transaction_date)
                VALUES (from_acc, 'Withdrawal', amount, CURDATE());
                
                INSERT INTO Transaction (account_id, transaction_type, amount, transaction_date)
                VALUES (to_acc, 'Deposit', amount, CURDATE());

                COMMIT;
            END;
        `);

        await conn.query(`
            DROP PROCEDURE IF EXISTS CalculateInterest;
        `);
        await conn.query(`
            CREATE PROCEDURE CalculateInterest()
            BEGIN
                UPDATE Account
                SET balance = balance + (balance * 0.02)
                WHERE account_type = 'Savings';
            END;
        `);

        await logSQL(conn, '-- Database initialization complete.');
        console.log('Database schema, seeds, triggers, and procedures successfully set up!');
    } finally {
        conn.release();
    }
}

// REST API Endpoints

// 1. Fetch entire database cache for frontend
app.get('/api/data', async (req, res) => {
    try {
        const tables = ['Customer', 'Branch', 'Account', 'Transaction', 'Loan', 'Employee'];
        const data = {};

        for (const table of tables) {
            const [rows] = await pool.query(`SELECT * FROM ??`, [table]);
            data[table] = rows;
        }

        const [sqlLogs] = await pool.query('SELECT * FROM sql_logs ORDER BY log_id ASC');
        
        // Compute dashboard stats
        const [sumRes] = await pool.query('SELECT SUM(balance) AS totalDeposits FROM Account');
        const [custRes] = await pool.query('SELECT COUNT(*) AS customerCount FROM Customer');
        const [accRes] = await pool.query('SELECT COUNT(*) AS accountCount FROM Account');
        const [loanRes] = await pool.query("SELECT COUNT(*) AS activeLoanCount FROM Loan WHERE status = 'Approved'");

        const stats = {
            totalDeposits: Number(sumRes[0].totalDeposits || 0),
            customerCount: Number(custRes[0].customerCount || 0),
            accountCount: Number(accRes[0].accountCount || 0),
            activeLoanCount: Number(loanRes[0].activeLoanCount || 0)
        };

        res.json({
            success: true,
            tables: data,
            sqlLogs: sqlLogs.map(l => ({
                timestamp: l.timestamp,
                sql: l.sql_text,
                status: l.status,
                error: l.error_msg
            })),
            stats
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. Insert row
app.post('/api/table/:tableName', async (req, res) => {
    const { tableName } = req.params;
    const rowData = req.body;

    const cols = Object.keys(rowData).join(', ');
    const vals = Object.values(rowData).map(v => typeof v === 'string' ? `'${v}'` : v).join(', ');
    const sqlText = `INSERT INTO ${tableName} (${cols}) VALUES (${vals});`;

    const conn = await pool.getConnection();
    try {
        // Enforce PK conversion/validation
        const cleanData = { ...rowData };
        const keysToConvert = ['customer_id', 'branch_id', 'account_id', 'transaction_id', 'loan_id', 'employee_id'];
        keysToConvert.forEach(k => {
            if (cleanData[k] !== undefined && cleanData[k] !== '') {
                cleanData[k] = parseInt(cleanData[k]);
            }
        });
        if (cleanData.balance !== undefined) cleanData.balance = parseFloat(cleanData.balance);
        if (cleanData.amount !== undefined) cleanData.amount = parseFloat(cleanData.amount);

        await conn.query('INSERT INTO ?? SET ?', [tableName, cleanData]);
        await logSQL(conn, sqlText, 'SUCCESS');
        res.json({ success: true });
    } catch (err) {
        let errorMsg = err.message;
        if (err.code === 'ER_DUP_ENTRY') {
            if (err.message.toLowerCase().includes("phone")) {
                errorMsg = "A customer with this phone number already exists.";
            } else {
                errorMsg = "Duplicate entry: a record with this primary key or unique constraint already exists.";
            }
        }
        await logSQL(conn, sqlText, 'ERROR', errorMsg);
        res.status(400).json({ success: false, error: errorMsg });
    } finally {
        conn.release();
    }
});

// 3. Delete row
app.delete('/api/table/:tableName/:keyName/:keyValue', async (req, res) => {
    const { tableName, keyName, keyValue } = req.params;
    const sqlText = `DELETE FROM ${tableName} WHERE ${keyName} = ${keyValue};`;

    const conn = await pool.getConnection();
    try {
        await conn.query(`DELETE FROM ?? WHERE ?? = ?`, [tableName, keyName, keyValue]);
        await logSQL(conn, sqlText, 'SUCCESS');
        res.json({ success: true });
    } catch (err) {
        let errorMsg = err.message;
        // Map foreign key constraint errors to matches simulator messages
        if (err.code === 'ER_ROW_IS_REFERENCED_2') {
            if (tableName === 'Customer') {
                errorMsg = "Cannot delete customer: they have active accounts or outstanding loans.";
            } else if (tableName === 'Branch') {
                errorMsg = "Cannot delete branch: accounts are assigned to this branch or employees work here.";
            } else if (tableName === 'Account') {
                errorMsg = "Cannot delete account: transactions exist for this account.";
            }
        }
        await logSQL(conn, sqlText, 'ERROR', errorMsg);
        res.status(400).json({ success: false, error: errorMsg });
    } finally {
        conn.release();
    }
});

// 4. Procedure: Transfer Funds
app.post('/api/procedure/transfer', async (req, res) => {
    const { fromAcc, toAcc, amount } = req.body;
    const sqlText = `CALL TransferFunds(${fromAcc}, ${toAcc}, ${amount});`;

    const conn = await pool.getConnection();
    try {
        await conn.query('CALL TransferFunds(?, ?, ?)', [fromAcc, toAcc, amount]);
        await logSQL(conn, sqlText, 'SUCCESS');
        res.json({
            success: true,
            message: `Transferred ${Number(amount).toFixed(2)} from Account ${fromAcc} to Account ${toAcc} successfully.`
        });
    } catch (err) {
        await logSQL(conn, sqlText, 'ERROR', err.message);
        res.status(400).json({ success: false, error: err.message });
    } finally {
        conn.release();
    }
});

// 5. Procedure: Calculate Interest
app.post('/api/procedure/interest', async (req, res) => {
    const sqlText = `CALL CalculateInterest();`;

    const conn = await pool.getConnection();
    try {
        // Fetch list before
        const [listBefore] = await conn.query('SELECT * FROM Account');

        // Run interest calculation
        await conn.query('CALL CalculateInterest()');

        // Fetch list after
        const [listAfter] = await conn.query('SELECT * FROM Account');

        const affectedCount = listBefore.filter((b, i) => b.balance !== listAfter[i].balance).length;

        await logSQL(conn, sqlText, 'SUCCESS');
        res.json({
            success: true,
            message: `Interest calculated successfully for ${affectedCount} Savings accounts.`,
            listBefore,
            listAfter
        });
    } catch (err) {
        await logSQL(conn, sqlText, 'ERROR', err.message);
        res.status(400).json({ success: false, error: err.message });
    } finally {
        conn.release();
    }
});

// 6. Predefined Query execution
app.get('/api/query/:index', async (req, res) => {
    const index = parseInt(req.params.index);
    let sqlText = '';
    let title = '';

    switch (index) {
        case 1:
            title = "Retrieve all customers";
            sqlText = "SELECT * FROM Customer;";
            break;
        case 2:
            title = "Display accounts with balance greater than 50000";
            sqlText = "SELECT * FROM Account WHERE balance > 50000;";
            break;
        case 3:
            title = "Display transaction details with account information (2-table INNER JOIN)";
            sqlText = `SELECT t.transaction_id, t.transaction_type, t.amount, a.account_id, a.account_type FROM Transaction t INNER JOIN Account a ON t.account_id = a.account_id;`;
            break;
        case 4:
            title = "Display customer, account, and branch details (3-table JOIN)";
            sqlText = `SELECT c.name, a.account_id, b.branch_name, b.location FROM Customer c JOIN Account a ON c.customer_id = a.customer_id JOIN Branch b ON a.branch_id = b.branch_id;`;
            break;
        case 5:
            title = "Count number of accounts per branch (GROUP BY)";
            sqlText = `SELECT branch_id, COUNT(account_id) AS total_accounts FROM Account GROUP BY branch_id;`;
            break;
        case 6:
            title = "Display branches having total deposits greater than 1,00,000 (HAVING)";
            sqlText = `SELECT branch_id, SUM(balance) AS total_deposit FROM Account GROUP BY branch_id HAVING SUM(balance) > 100000;`;
            break;
        case 7:
            title = "Retrieve customers whose account balance is greater than the average account balance (Subquery)";
            sqlText = `SELECT c.name, a.balance FROM Customer c JOIN Account a ON c.customer_id = a.customer_id WHERE a.balance > (SELECT AVG(balance) FROM Account);`;
            break;
        case 8:
            title = "Retrieve customers whose total transaction amount exceeds that of a specific customer (Correlated Subquery)";
            sqlText = `SELECT c.name, SUM(t.amount) AS total_transaction FROM Customer c JOIN Account a ON c.customer_id = a.customer_id JOIN Transaction t ON a.account_id = t.account_id GROUP BY c.customer_id, c.name HAVING SUM(t.amount) > (SELECT SUM(t2.amount) FROM Customer c2 JOIN Account a2 ON c2.customer_id = a2.customer_id JOIN Transaction t2 ON a2.account_id = t2.account_id WHERE c2.customer_id = 1);`;
            break;
        case 9:
            title = "Display all customers including those without accounts (LEFT JOIN)";
            sqlText = `SELECT c.name, a.account_id FROM Customer c LEFT JOIN Account a ON c.customer_id = a.customer_id;`;
            break;
        case 10:
            title = "Retrieve accounts with no transactions (NOT EXISTS)";
            sqlText = `SELECT * FROM Account a WHERE NOT EXISTS (SELECT * FROM Transaction t WHERE t.account_id = a.account_id);`;
            break;
        default:
            return res.status(400).json({ success: false, error: 'Invalid query index' });
    }

    const conn = await pool.getConnection();
    try {
        const [rows, fields] = await conn.query(sqlText);
        const columns = fields ? fields.map(f => f.name) : [];
        await logSQL(conn, sqlText, 'SUCCESS');
        res.json({
            success: true,
            title,
            sql: sqlText,
            columns,
            rows: rows.map(r => ({ ...r }))
        });
    } catch (err) {
        await logSQL(conn, sqlText, 'ERROR', err.message);
        res.status(400).json({ success: false, error: err.message });
    } finally {
        conn.release();
    }
});

// 7. Execute raw custom SQL query
app.post('/api/execute-sql', async (req, res) => {
    const { query } = req.body;
    const normalized = query.trim().replace(/\s+/g, ' ');
    const upper = normalized.toUpperCase();

    const conn = await pool.getConnection();
    try {
        if (upper.startsWith('SELECT')) {
            const [rows, fields] = await conn.query(normalized);
            const columns = fields ? fields.map(f => f.name) : [];
            await logSQL(conn, normalized, 'SUCCESS');
            res.json({
                success: true,
                title: 'Custom SELECT query',
                sql: normalized,
                columns,
                rows
            });
        } else {
            const [result] = await conn.query(normalized);
            await logSQL(conn, normalized, 'SUCCESS');
            res.json({
                success: true,
                message: `SQL statement executed successfully. Rows affected: ${result.affectedRows || 0}`
            });
        }
    } catch (err) {
        await logSQL(conn, normalized, 'ERROR', err.message);
        res.status(400).json({ success: false, error: err.message });
    } finally {
        conn.release();
    }
});

// 8. Reset database
app.post('/api/reset', async (req, res) => {
    console.log('Resetting database...');
    const conn = await pool.getConnection();
    try {
        // Drop existing tables
        const tables = ['Transaction', 'Loan', 'Employee', 'Account', 'Customer', 'Branch', 'sql_logs'];
        await conn.query('SET FOREIGN_KEY_CHECKS = 0;');
        for (const table of tables) {
            await conn.query(`DROP TABLE IF EXISTS ??`, [table]);
        }
        await conn.query('SET FOREIGN_KEY_CHECKS = 1;');

        // Close current pool and re-initialize
        conn.release();
        await pool.end();

        // Re-run initialization
        await initializeDatabase();

        res.json({ success: true, message: 'Database reset and initialized successfully.' });
    } catch (err) {
        console.error('Error resetting database:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Start Express Server
(async () => {
    try {
        await initializeDatabase();
        app.listen(PORT, () => {
            console.log(`Server is running at http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('Initialization error:', err);
    }
})();

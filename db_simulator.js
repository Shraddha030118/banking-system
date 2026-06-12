/**
 * db_simulator.js (MySQL API Bridge)
 * Bridges the front-end UI with the real MySQL Express backend database.
 */

class BankingDB {
    constructor() {
        this.tables = {
            Customer: [],
            Branch: [],
            Account: [],
            Transaction: [],
            Loan: [],
            Employee: []
        };
        this.sqlLogs = [];
        this.baseUrl = '/api'; // Relative URL since served from same express server
    }

    async init() {
        await this.refresh();
    }

    async refresh() {
        try {
            const res = await fetch(`${this.baseUrl}/data`);
            const data = await res.json();
            if (data.success) {
                this.tables = data.tables;
                this.sqlLogs = data.sqlLogs;
            } else {
                console.error("Failed to fetch database state:", data.error);
            }
        } catch (e) {
            console.error("Failed to connect to backend database server:", e);
        }
    }

    logSQL(sql, status, error) {
        window.dispatchEvent(new CustomEvent('sql-logged', { detail: { sql, status, error } }));
    }

    async resetDatabase() {
        const sql = '-- Resetting database...';
        try {
            const res = await fetch(`${this.baseUrl}/reset`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                this.logSQL('-- Re-initialized database schema and seeded data...', 'SUCCESS', '');
                await this.refresh();
                return { success: true };
            } else {
                this.logSQL(sql, 'ERROR', data.error);
                throw new Error(data.error);
            }
        } catch (e) {
            this.logSQL(sql, 'ERROR', e.message);
            throw e;
        }
    }

    async insertRow(tableName, data) {
        const cols = Object.keys(data).join(', ');
        const vals = Object.values(data).map(v => typeof v === 'string' ? `'${v}'` : v).join(', ');
        const sql = `INSERT INTO ${tableName} (${cols}) VALUES (${vals});`;
        try {
            const res = await fetch(`${this.baseUrl}/table/${tableName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const resData = await res.json();
            if (resData.success) {
                this.logSQL(sql, 'SUCCESS', '');
                await this.refresh();
                return { success: true };
            } else {
                this.logSQL(sql, 'ERROR', resData.error);
                throw new Error(resData.error);
            }
        } catch (e) {
            this.logSQL(sql, 'ERROR', e.message);
            throw e;
        }
    }

    async deleteRow(tableName, keyName, keyValue) {
        const sql = `DELETE FROM ${tableName} WHERE ${keyName} = ${keyValue};`;
        try {
            const res = await fetch(`${this.baseUrl}/table/${tableName}/${keyName}/${keyValue}`, {
                method: 'DELETE'
            });
            const resData = await res.json();
            if (resData.success) {
                this.logSQL(sql, 'SUCCESS', '');
                await this.refresh();
                return { success: true };
            } else {
                this.logSQL(sql, 'ERROR', resData.error);
                throw new Error(resData.error);
            }
        } catch (e) {
            this.logSQL(sql, 'ERROR', e.message);
            throw e;
        }
    }

    async transferFunds(fromAcc, toAcc, amount) {
        const sql = `CALL TransferFunds(${fromAcc}, ${toAcc}, ${amount});`;
        try {
            const res = await fetch(`${this.baseUrl}/procedure/transfer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fromAcc, toAcc, amount })
            });
            const resData = await res.json();
            if (resData.success) {
                this.logSQL(sql, 'SUCCESS', '');
                await this.refresh();
                return resData;
            } else {
                this.logSQL(sql, 'ERROR', resData.error);
                throw new Error(resData.error);
            }
        } catch (e) {
            this.logSQL(sql, 'ERROR', e.message);
            throw e;
        }
    }

    async calculateInterest() {
        const sql = `CALL CalculateInterest();`;
        try {
            const res = await fetch(`${this.baseUrl}/procedure/interest`, {
                method: 'POST'
            });
            const resData = await res.json();
            if (resData.success) {
                this.logSQL(sql, 'SUCCESS', '');
                await this.refresh();
                return resData;
            } else {
                this.logSQL(sql, 'ERROR', resData.error);
                throw new Error(resData.error);
            }
        } catch (e) {
            this.logSQL(sql, 'ERROR', e.message);
            throw e;
        }
    }

    async runPredefinedQuery(index) {
        try {
            const res = await fetch(`${this.baseUrl}/query/${index}`);
            const resData = await res.json();
            if (resData.success) {
                this.logSQL(resData.sql, 'SUCCESS', '');
                await this.refresh();
                return resData;
            } else {
                this.logSQL(`SELECT ... (Query ${index})`, 'ERROR', resData.error);
                throw new Error(resData.error);
            }
        } catch (e) {
            this.logSQL(`SELECT ... (Query ${index})`, 'ERROR', e.message);
            throw e;
        }
    }

    async executeSQL(queryText) {
        try {
            const res = await fetch(`${this.baseUrl}/execute-sql`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: queryText })
            });
            const resData = await res.json();
            if (resData.success) {
                this.logSQL(queryText, 'SUCCESS', '');
                await this.refresh();
                return resData;
            } else {
                this.logSQL(queryText, 'ERROR', resData.error);
                throw new Error(resData.error);
            }
        } catch (e) {
            this.logSQL(queryText, 'ERROR', e.message);
            throw e;
        }
    }
}

// Instantiate and expose globally
window.db = new BankingDB();

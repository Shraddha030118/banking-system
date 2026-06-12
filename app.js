/**
 * app.js
 * Main UI Controller for Banking Management System Front-End
 * Coordinates UI tabs, forms, modals, tables rendering, query execution, and terminal logging.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Current state variables
    let activeTable = 'Customer';
    let selectedQueryIndex = null;
    let depositChartObj = null;
    let loanChartObj = null;

    // Toast Notification System
    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        let iconClass = 'fa-info-circle';
        if (type === 'success') iconClass = 'fa-check-circle';
        if (type === 'error') iconClass = 'fa-exclamation-circle';
        
        toast.innerHTML = `
            <i class="fas ${iconClass}"></i>
            <span>${message}</span>
        `;
        
        container.appendChild(toast);
        
        // Remove toast after animation completes
        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s ease forwards';
            setTimeout(() => {
                toast.remove();
            }, 300);
        }, 4000);
    }

    // Tab Switching Logic
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.view-section');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetSection = item.getAttribute('data-section');
            
            navItems.forEach(i => i.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));
            
            item.classList.add('active');
            const targetEl = document.getElementById(targetSection);
            if (targetEl) targetEl.classList.add('active');

            // Hook for sections that need updates when viewed
            if (targetSection === 'dashboard') {
                updateDashboardStats();
                initOrUpdateCharts();
                updateDashboardLogs();
            } else if (targetSection === 'tables') {
                renderActiveTable();
            } else if (targetSection === 'procedures') {
                loadAccountDropdowns();
            }
        });
    });

    // --- VIEW 1: DASHBOARD LOGIC ---
    function updateDashboardStats() {
        const accounts = window.db.tables.Account;
        const customers = window.db.tables.Customer;
        const loans = window.db.tables.Loan;

        const totalDeposits = accounts.reduce((sum, a) => sum + a.balance, 0);
        const customerCount = customers.length;
        const accountCount = accounts.length;
        const activeLoanCount = loans.filter(l => l.status === 'Approved').length;

        document.getElementById('stat-total-deposits').innerText = `₹${totalDeposits.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById('stat-customers').innerText = customerCount;
        document.getElementById('stat-accounts').innerText = accountCount;
        document.getElementById('stat-loans').innerText = activeLoanCount;
    }

    function updateDashboardLogs() {
        const logContent = document.getElementById('recent-logs-list');
        if (!logContent) return;
        
        logContent.innerHTML = '';
        const recentLogs = window.db.sqlLogs.slice(-6).reverse(); // last 6 logs
        
        if (recentLogs.length === 0) {
            logContent.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; padding: 10px;">No executions yet.</div>';
            return;
        }

        recentLogs.forEach(entry => {
            const el = document.createElement('div');
            el.className = `log-entry ${entry.status.toLowerCase()}`;
            el.style.fontSize = '0.75rem';
            el.style.margin = '4px 0';
            el.innerHTML = `
                <div class="log-header-info">
                    <span class="log-time">${entry.timestamp}</span>
                    <span class="log-status ${entry.status.toLowerCase()}">${entry.status}</span>
                </div>
                <div class="log-sql" style="font-size: 0.75rem; color: #a1a1aa; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${entry.sql}</div>
            `;
            logContent.appendChild(el);
        });
    }

    function initOrUpdateCharts() {
        const ctxDeposit = document.getElementById('depositChart');
        const ctxLoan = document.getElementById('loanChart');
        if (!ctxDeposit || !ctxLoan) return;

        // Group data
        const branchData = {};
        window.db.tables.Branch.forEach(b => {
            branchData[b.branch_id] = { name: b.branch_name, balance: 0, count: 0 };
        });
        window.db.tables.Account.forEach(a => {
            if (branchData[a.branch_id]) {
                branchData[a.branch_id].balance += a.balance;
                branchData[a.branch_id].count++;
            }
        });

        const branchLabels = Object.values(branchData).map(d => d.name);
        const branchDeposits = Object.values(branchData).map(d => d.balance);

        // Loan status counts
        const loanStatuses = { Approved: 0, Pending: 0, Rejected: 0 };
        window.db.tables.Loan.forEach(l => {
            if (loanStatuses[l.status] !== undefined) {
                loanStatuses[l.status]++;
            }
        });

        // 1. Branch Deposits Chart (Bar Chart)
        if (depositChartObj) {
            depositChartObj.data.labels = branchLabels;
            depositChartObj.data.datasets[0].data = branchDeposits;
            depositChartObj.update();
        } else {
            depositChartObj = new Chart(ctxDeposit, {
                type: 'bar',
                data: {
                    labels: branchLabels,
                    datasets: [{
                        label: 'Total Deposits (₹)',
                        data: branchDeposits,
                        backgroundColor: [
                            'rgba(59, 130, 246, 0.65)',
                            'rgba(6, 182, 212, 0.65)'
                        ],
                        borderColor: [
                            'rgba(59, 130, 246, 1)',
                            'rgba(6, 182, 212, 1)'
                        ],
                        borderWidth: 1.5,
                        borderRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return ` ₹${context.raw.toLocaleString('en-IN')}`;
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            grid: { color: 'rgba(255, 255, 255, 0.05)' },
                            ticks: {
                                color: '#94a3b8',
                                callback: function(value) { return '₹' + value.toLocaleString('en-IN'); }
                            }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { color: '#94a3b8' }
                        }
                    }
                }
            });
        }

        // 2. Loans Status Chart (Doughnut)
        const loanLabels = Object.keys(loanStatuses);
        const loanCounts = Object.values(loanStatuses);

        if (loanChartObj) {
            loanChartObj.data.labels = loanLabels;
            loanChartObj.data.datasets[0].data = loanCounts;
            loanChartObj.update();
        } else {
            loanChartObj = new Chart(ctxLoan, {
                type: 'doughnut',
                data: {
                    labels: loanLabels,
                    datasets: [{
                        data: loanCounts,
                        backgroundColor: [
                            'rgba(16, 185, 129, 0.65)', // Approved (Green)
                            'rgba(245, 158, 11, 0.65)', // Pending (Amber)
                            'rgba(244, 63, 94, 0.65)'   // Rejected (Red)
                        ],
                        borderColor: [
                            'rgba(16, 185, 129, 1)',
                            'rgba(245, 158, 11, 1)',
                            'rgba(244, 63, 94, 1)'
                        ],
                        borderWidth: 1.5
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 } }
                        }
                    },
                    cutout: '65%'
                }
            });
        }
    }


    // --- VIEW 2: DATABASE VIEWER LOGIC ---
    const dbTabs = document.querySelectorAll('#db-tabs .tab-btn');
    dbTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            dbTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeTable = tab.getAttribute('data-table');
            
            // Update UI Title & Add Row Button
            document.getElementById('selected-table-name').innerText = activeTable;
            
            // Render active table
            renderActiveTable();
        });
    });

    // Search filter input
    const tableSearch = document.getElementById('table-search');
    tableSearch.addEventListener('input', () => {
        renderActiveTable(tableSearch.value);
    });

    function renderActiveTable(searchTerm = '') {
        const dataset = window.db.tables[activeTable];
        const tableHeader = document.getElementById('table-header');
        const tableBody = document.getElementById('table-body');
        
        tableHeader.innerHTML = '';
        tableBody.innerHTML = '';

        if (!dataset || dataset.length === 0) {
            tableHeader.innerHTML = `<th>No Columns</th>`;
            tableBody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted);">Table is empty.</td></tr>`;
            return;
        }

        // Render headers
        const columns = Object.keys(dataset[0]);
        columns.forEach(col => {
            const th = document.createElement('th');
            th.innerText = col.replace('_', ' ').toUpperCase();
            tableHeader.appendChild(th);
        });
        
        // Add action header
        const actionTh = document.createElement('th');
        actionTh.innerText = 'ACTIONS';
        actionTh.style.textAlign = 'right';
        tableHeader.appendChild(actionTh);

        // Filter datasets based on search
        let filteredData = dataset;
        if (searchTerm.trim() !== '') {
            const term = searchTerm.toLowerCase();
            filteredData = dataset.filter(row => {
                return Object.values(row).some(val => 
                    String(val).toLowerCase().includes(term)
                );
            });
        }

        // Render rows
        if (filteredData.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="${columns.length + 1}" style="text-align: center; color: var(--text-muted);">No records match your search.</td></tr>`;
            return;
        }

        const primaryKeyMap = {
            Customer: 'customer_id',
            Branch: 'branch_id',
            Account: 'account_id',
            Transaction: 'transaction_id',
            Loan: 'loan_id',
            Employee: 'employee_id'
        };
        const pk = primaryKeyMap[activeTable];

        filteredData.forEach(row => {
            const tr = document.createElement('tr');
            
            columns.forEach(col => {
                const td = document.createElement('td');
                let val = row[col];
                
                // Format numeric currency fields
                if ((col === 'balance' || col === 'amount') && typeof val === 'number') {
                    td.innerText = `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
                    td.style.fontWeight = '500';
                    td.style.color = '#e2e8f0';
                } else {
                    td.innerText = val;
                }
                tr.appendChild(td);
            });

            // Action delete button
            const actionTd = document.createElement('td');
            actionTd.style.textAlign = 'right';
            actionTd.innerHTML = `
                <div class="action-cell" style="justify-content: flex-end;">
                    <button class="icon-btn icon-btn-danger delete-row-btn" data-pk="${row[pk]}">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            `;
            
            // Delete action
            actionTd.querySelector('.delete-row-btn').addEventListener('click', async (e) => {
                const rowId = e.currentTarget.getAttribute('data-pk');
                if (confirm(`Are you sure you want to delete this record from ${activeTable} (${pk} = ${rowId})?`)) {
                    try {
                        await window.db.deleteRow(activeTable, pk, rowId);
                        showToast(`Row deleted successfully from ${activeTable}`, 'success');
                        renderActiveTable(tableSearch.value);
                        updateDashboardStats();
                    } catch (err) {
                        showToast(err.message, 'error');
                    }
                }
            });

            tr.appendChild(actionTd);
            tableBody.appendChild(tr);
        });
    }

    // Modal Add Row System
    const addRowBtn = document.getElementById('add-row-btn');
    const rowModal = document.getElementById('row-modal');
    const modalClose = document.getElementById('modal-close');
    const cancelModalBtn = document.getElementById('cancel-modal-btn');
    const modalForm = document.getElementById('modal-form');
    const modalFieldsContainer = document.getElementById('modal-fields-container');
    const modalTitleEl = document.getElementById('modal-table-title');

    function openModal() {
        modalTitleEl.innerText = activeTable;
        modalFieldsContainer.innerHTML = '';
        
        // Define schemas for forms
        const formFields = {
            Customer: [
                { name: 'customer_id', label: 'Customer ID', type: 'number', required: true, placeholder: 'e.g. 5' },
                { name: 'name', label: 'Customer Name', type: 'text', required: true, placeholder: 'e.g. Shraddha' },
                { name: 'phone', label: 'Phone Number', type: 'tel', required: true, placeholder: 'e.g. 9876543210' },
                { name: 'address', label: 'Address', type: 'text', required: true, placeholder: 'e.g. Udupi' }
            ],
            Branch: [
                { name: 'branch_id', label: 'Branch ID', type: 'number', required: true, placeholder: 'e.g. 103' },
                { name: 'branch_name', label: 'Branch Name', type: 'text', required: true, placeholder: 'e.g. Sub Branch' },
                { name: 'location', label: 'Location', type: 'text', required: true, placeholder: 'e.g. Manipal' }
            ],
            Account: [
                { name: 'account_id', label: 'Account ID', type: 'number', required: true, placeholder: 'e.g. 1004' },
                { name: 'customer_id', label: 'Customer', type: 'select', required: true, optionsSource: 'Customer', displayField: 'name', keyField: 'customer_id' },
                { name: 'branch_id', label: 'Branch', type: 'select', required: true, optionsSource: 'Branch', displayField: 'branch_name', keyField: 'branch_id' },
                { name: 'account_type', label: 'Account Type', type: 'select', required: true, options: ['Savings', 'Current'] },
                { name: 'balance', label: 'Initial Balance (₹)', type: 'number', required: true, min: '1000', placeholder: 'Min 1000' }
            ],
            Transaction: [
                { name: 'transaction_id', label: 'Transaction ID', type: 'number', required: true, placeholder: 'e.g. 4' },
                { name: 'account_id', label: 'Account', type: 'select', required: true, optionsSource: 'Account', displayField: 'account_id', keyField: 'account_id' },
                { name: 'transaction_type', label: 'Transaction Type', type: 'select', required: true, options: ['Deposit', 'Withdrawal'] },
                { name: 'amount', label: 'Amount (₹)', type: 'number', required: true, min: '1', placeholder: 'Amount' },
                { name: 'transaction_date', label: 'Transaction Date', type: 'date', required: true }
            ],
            Loan: [
                { name: 'loan_id', label: 'Loan ID', type: 'number', required: true, placeholder: 'e.g. 203' },
                { name: 'customer_id', label: 'Customer', type: 'select', required: true, optionsSource: 'Customer', displayField: 'name', keyField: 'customer_id' },
                { name: 'amount', label: 'Loan Amount (₹)', type: 'number', required: true, placeholder: 'Amount' },
                { name: 'loan_type', label: 'Loan Type', type: 'text', required: true, placeholder: 'e.g. Home Loan' },
                { name: 'status', label: 'Loan Status', type: 'select', required: true, options: ['Pending', 'Approved', 'Rejected'] }
            ],
            Employee: [
                { name: 'employee_id', label: 'Employee ID', type: 'number', required: true, placeholder: 'e.g. 303' },
                { name: 'name', label: 'Employee Name', type: 'text', required: true, placeholder: 'e.g. Ramesh' },
                { name: 'branch_id', label: 'Branch Assigned', type: 'select', required: true, optionsSource: 'Branch', displayField: 'branch_name', keyField: 'branch_id' },
                { name: 'role', label: 'Role', type: 'text', required: true, placeholder: 'e.g. Cashier' }
            ]
        };

        const fields = formFields[activeTable];
        fields.forEach(field => {
            const formGrp = document.createElement('div');
            formGrp.className = 'form-group';
            
            const label = document.createElement('label');
            label.innerText = field.label;
            formGrp.appendChild(label);

            if (field.type === 'select') {
                const select = document.createElement('select');
                select.className = 'form-control';
                select.name = field.name;
                select.required = field.required;

                if (field.options) {
                    field.options.forEach(opt => {
                        const option = document.createElement('option');
                        option.value = opt;
                        option.innerText = opt;
                        select.appendChild(option);
                    });
                } else if (field.optionsSource) {
                    const sourceData = window.db.tables[field.optionsSource];
                    sourceData.forEach(row => {
                        const option = document.createElement('option');
                        option.value = row[field.keyField];
                        
                        if (field.optionsSource === 'Customer') {
                            option.innerText = `${row.name} (ID: ${row.customer_id})`;
                        } else if (field.optionsSource === 'Branch') {
                            option.innerText = `${row.branch_name} (${row.location})`;
                        } else if (field.optionsSource === 'Account') {
                            option.innerText = `Acc ${row.account_id} - ${row.account_type} (Balance: ₹${row.balance.toLocaleString('en-IN')})`;
                        } else {
                            option.innerText = row[field.displayField];
                        }
                        
                        select.appendChild(option);
                    });
                }
                formGrp.appendChild(select);
            } else {
                const input = document.createElement('input');
                input.className = 'form-control';
                input.name = field.name;
                input.type = field.type;
                input.required = field.required;
                if (field.placeholder) input.placeholder = field.placeholder;
                if (field.min) input.min = field.min;
                
                // Pre-populate date field with today
                if (field.type === 'date') {
                    input.value = new Date().toISOString().split('T')[0];
                }
                
                // Pre-fill incremented PKs if possible
                if (field.name.endsWith('_id') && field.name !== 'customer_id' && field.name !== 'branch_id' && field.name !== 'account_id') {
                    const existingVals = window.db.tables[activeTable].map(r => r[field.name]);
                    const nextId = existingVals.length > 0 ? Math.max(...existingVals) + 1 : 1;
                    input.value = nextId;
                }

                formGrp.appendChild(input);
            }
            modalFieldsContainer.appendChild(formGrp);
        });

        rowModal.classList.add('active');
    }

    function closeModal() {
        rowModal.classList.remove('active');
        modalForm.reset();
    }

    addRowBtn.addEventListener('click', openModal);
    modalClose.addEventListener('click', closeModal);
    cancelModalBtn.addEventListener('click', closeModal);

    modalForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(modalForm);
        const data = {};
        for (const [key, value] of formData.entries()) {
            data[key] = value;
        }

        try {
            await window.db.insertRow(activeTable, data);
            showToast(`Inserted 1 row successfully into ${activeTable}`, 'success');
            closeModal();
            renderActiveTable();
            updateDashboardStats();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });


    // --- VIEW 3: QUERY HUB LOGIC ---
    const queryCards = document.querySelectorAll('.query-card');
    const queryDisplay = document.getElementById('query-display-area');

    queryCards.forEach(card => {
        card.addEventListener('click', () => {
            queryCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            
            selectedQueryIndex = parseInt(card.getAttribute('data-index'));
            loadPredefinedQueryDetails(selectedQueryIndex);
        });
    });

    async function loadPredefinedQueryDetails(index) {
        // Run DB simulator code to fetch pre-defined text structures (without running the actual data query yet)
        const qInfo = await window.db.runPredefinedQuery(index);
        
        queryDisplay.innerHTML = `
            <div class="card-title">
                <span>Query ${index}: ${qInfo.title}</span>
                <button class="btn btn-primary" id="execute-predefined-btn"><i class="fas fa-play"></i> Run Query</button>
            </div>
            
            <div class="sql-preview-box">${qInfo.sql}</div>
            
            <div class="query-result-wrapper">
                <div class="card-title" style="font-size: 0.95rem; color: var(--text-secondary); margin-bottom: 12px;">Result Set</div>
                <div class="table-container" style="max-height: 350px; overflow-y: auto;">
                    <table class="db-table" id="query-result-table">
                        <thead>
                            <tr id="query-result-header">
                                <!-- Dynamic headers -->
                            </tr>
                        </thead>
                        <tbody id="query-result-body">
                            <tr><td style="color: var(--text-muted); text-align: center;" colspan="100">Click "Run Query" to fetch results.</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        document.getElementById('execute-predefined-btn').addEventListener('click', () => {
            executeAndRenderQuery(index);
        });
    }

    async function executeAndRenderQuery(index) {
        try {
            const res = await window.db.runPredefinedQuery(index);
            const headerRow = document.getElementById('query-result-header');
            const bodyRow = document.getElementById('query-result-body');

            headerRow.innerHTML = '';
            bodyRow.innerHTML = '';

            if (res.rows.length === 0) {
                headerRow.innerHTML = `<th>Message</th>`;
                bodyRow.innerHTML = `<tr><td style="text-align: center; color: var(--text-warning);">Empty set returned.</td></tr>`;
                showToast("Query completed successfully. (Empty result)", "info");
                return;
            }

            // Headers
            res.columns.forEach(col => {
                const th = document.createElement('th');
                th.innerText = col.replace('_', ' ').toUpperCase();
                headerRow.appendChild(th);
            });

            // Rows
            res.rows.forEach(row => {
                const tr = document.createElement('tr');
                res.columns.forEach(col => {
                    const td = document.createElement('td');
                    let val = row[col];
                    if ((col === 'balance' || col === 'amount' || col === 'total_deposit' || col === 'total_transaction') && typeof val === 'number') {
                        td.innerText = `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
                        td.style.fontWeight = '500';
                        td.style.color = '#e2e8f0';
                    } else {
                        td.innerText = val;
                    }
                    tr.appendChild(td);
                });
                bodyRow.appendChild(tr);
            });

            showToast("Query executed successfully!", "success");
        } catch (err) {
            showToast(`Query error: ${err.message}`, "error");
        }
    }


    // --- VIEW 4: PROCEDURES & TRIGGERS LOGIC ---
    function loadAccountDropdowns() {
        const fromAccSelect = document.getElementById('proc-transfer-from');
        const toAccSelect = document.getElementById('proc-transfer-to');
        const triggerAccSelect = document.getElementById('trigger-tx-account');

        if (!fromAccSelect || !toAccSelect || !triggerAccSelect) return;

        fromAccSelect.innerHTML = '';
        toAccSelect.innerHTML = '';
        triggerAccSelect.innerHTML = '';

        const accounts = window.db.tables.Account;
        accounts.forEach(acc => {
            const opt1 = document.createElement('option');
            opt1.value = acc.account_id;
            opt1.innerText = `Account ${acc.account_id} - ${acc.account_type} (Balance: ₹${acc.balance.toLocaleString('en-IN')})`;
            fromAccSelect.appendChild(opt1);

            const opt2 = document.createElement('option');
            opt2.value = acc.account_id;
            opt2.innerText = `Account ${acc.account_id} - ${acc.account_type} (Balance: ₹${acc.balance.toLocaleString('en-IN')})`;
            toAccSelect.appendChild(opt2);

            const opt3 = document.createElement('option');
            opt3.value = acc.account_id;
            opt3.innerText = `Account ${acc.account_id} - ${acc.account_type} (Balance: ₹${acc.balance.toLocaleString('en-IN')})`;
            triggerAccSelect.appendChild(opt3);
        });
    }

    // Submit procedure: Transfer Funds
    const transferForm = document.getElementById('procedure-transfer-form');
    transferForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fromAcc = document.getElementById('proc-transfer-from').value;
        const toAcc = document.getElementById('proc-transfer-to').value;
        const amount = document.getElementById('proc-transfer-amount').value;
        const consoleOutput = document.getElementById('proc-transfer-output');

        consoleOutput.className = 'trigger-indicator-card';
        consoleOutput.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Executing transaction...';

        try {
            const res = await window.db.transferFunds(fromAcc, toAcc, amount);
            consoleOutput.style.display = 'block';
            consoleOutput.style.borderLeft = '4px solid var(--accent-success)';
            consoleOutput.innerHTML = `
                <div style="color: var(--accent-success); font-weight:600; font-size:0.9rem; margin-bottom:4px;">
                    <i class="fas fa-check-circle"></i> Success: Procedure Executed
                </div>
                <div style="font-size:0.8rem; color: var(--text-primary);">${res.message}</div>
            `;
            showToast("Transfer completed successfully", "success");
            loadAccountDropdowns();
            updateDashboardStats();
        } catch (err) {
            consoleOutput.style.display = 'block';
            consoleOutput.style.borderLeft = '4px solid var(--accent-error)';
            consoleOutput.innerHTML = `
                <div style="color: var(--accent-error); font-weight:600; font-size:0.9rem; margin-bottom:4px;">
                    <i class="fas fa-times-circle"></i> Error in Procedure Code
                </div>
                <div style="font-size:0.8rem; color: #fda4af;">${err.message}</div>
            `;
            showToast(err.message, "error");
        }
    });

    // Run procedure: Calculate Monthly Interest
    const runInterestBtn = document.getElementById('proc-interest-btn');
    const interestOutputTable = document.getElementById('interest-table-body');
    const interestOutputContainer = document.getElementById('proc-interest-output-container');

    runInterestBtn.addEventListener('click', async () => {
        try {
            const res = await window.db.calculateInterest();
            interestOutputContainer.style.display = 'block';
            interestOutputTable.innerHTML = '';
            
            // Build comparisons
            res.listBefore.forEach((beforeAcc, idx) => {
                const afterAcc = res.listAfter[idx];
                const isSavings = beforeAcc.account_type === 'Savings';

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${beforeAcc.account_id}</td>
                    <td>${beforeAcc.account_type}</td>
                    <td>₹${Number(beforeAcc.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td style="color: ${isSavings ? 'var(--accent-success)' : 'var(--text-muted)'}; font-weight:500;">
                        ${isSavings ? '+ 2.0%' : '0.0%'}
                    </td>
                    <td style="font-weight: 600; color: ${isSavings ? 'white' : 'var(--text-secondary)'};">
                        ₹${Number(afterAcc.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                `;
                interestOutputTable.appendChild(tr);
            });

            showToast(res.message, "success");
            loadAccountDropdowns();
            updateDashboardStats();
        } catch (err) {
            showToast(`Error: ${err.message}`, "error");
        }
    });

    // Submit transaction to test triggers
    const triggerForm = document.getElementById('trigger-test-form');
    triggerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const accId = document.getElementById('trigger-tx-account').value;
        const txType = document.getElementById('trigger-tx-type').value;
        const amount = document.getElementById('trigger-tx-amount').value;
        const outputEl = document.getElementById('trigger-test-output');
        
        outputEl.className = 'trigger-indicator-card';
        outputEl.style.display = 'block';

        const txId = window.db.tables.Transaction.length ? Math.max(...window.db.tables.Transaction.map(t => t.transaction_id)) + 1 : 1;
        const dateStr = new Date().toISOString().split('T')[0];

        try {
            await window.db.insertRow('Transaction', {
                transaction_id: txId,
                account_id: accId,
                transaction_type: txType,
                amount: amount,
                transaction_date: dateStr
            });

            outputEl.style.borderLeft = '4px solid var(--accent-success)';
            outputEl.innerHTML = `
                <div style="color: var(--accent-success); font-weight:600; font-size:0.9rem; margin-bottom:4px;">
                    <i class="fas fa-check-circle"></i> Success: Transaction Inserted
                </div>
                <div style="font-size:0.8rem; color: var(--text-secondary); line-height: 1.4;">
                    <strong>Trigger [UpdateBalanceAfterTransaction] Fired:</strong><br>
                    Updated Account balance successfully! Balance checked and updated on insertion.
                </div>
            `;
            showToast("Transaction successfully added!", "success");
            loadAccountDropdowns();
            updateDashboardStats();
        } catch (err) {
            outputEl.style.borderLeft = '4px solid var(--accent-error)';
            outputEl.innerHTML = `
                <div style="color: var(--accent-error); font-weight:600; font-size:0.9rem; margin-bottom:4px;">
                    <i class="fas fa-ban"></i> TRIGGER ABORTED OPERATION
                </div>
                <div style="font-size:0.8rem; color: #fda4af; line-height: 1.4;">
                    <strong>Trigger [MinimumBalanceCheck] Fired:</strong><br>
                    ${err.message}
                </div>
            `;
            showToast(err.message, "error");
        }
    });


    // --- VIEW 5: SQL CONSOLE LOGIC ---
    const rawSqlInput = document.getElementById('raw-sql-input');
    const runSqlBtn = document.getElementById('run-sql-btn');
    const logsContent = document.getElementById('logs-content');
    const clearLogsBtn = document.getElementById('clear-logs-btn');

    // Subscribe to DB SQL logger events
    window.addEventListener('sql-logged', (e) => {
        const entry = e.detail;
        
        const el = document.createElement('div');
        el.className = `log-entry ${entry.status.toLowerCase()}`;
        
        let statusSpan = `<span class="log-status success">[SUCCESS]</span>`;
        let errorDiv = '';
        
        if (entry.status === 'ERROR') {
            statusSpan = `<span class="log-status error">[ERROR]</span>`;
            errorDiv = `<div class="log-error-msg">${entry.error}</div>`;
        }

        el.innerHTML = `
            <div class="log-header-info">
                <span class="log-time">${new Date().toLocaleTimeString()}</span>
                ${statusSpan}
            </div>
            <div class="log-sql">${entry.sql}</div>
            ${errorDiv}
        `;
        
        logsContent.appendChild(el);
        // Scroll terminal to bottom
        logsContent.scrollTop = logsContent.scrollHeight;
    });

    runSqlBtn.addEventListener('click', async () => {
        const query = rawSqlInput.value.trim();
        if (query === '') return;

        try {
            const res = await window.db.executeSQL(query);
            rawSqlInput.value = ''; // Clear box on success

            // Check if SELECT query output is returned
            if (res && res.columns && res.rows) {
                // Show modal result viewer
                openConsoleResultModal(res);
            } else if (res && res.message) {
                showToast(res.message, "success");
            }
            updateDashboardStats();
        } catch (err) {
            showToast(err.message, "error");
        }
    });

    clearLogsBtn.addEventListener('click', () => {
        logsContent.innerHTML = '';
        showToast("SQL logs cleared.", "info");
    });

    // Console Query Modal Viewer
    function openConsoleResultModal(res) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay active';
        modal.style.zIndex = '300';
        
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 750px; width: 90%;">
                <div class="modal-header">
                    <span class="modal-title" style="color: var(--accent-cyan); font-family: var(--font-heading); font-weight:700;">
                        SQL Query Output: ${res.title}
                    </span>
                    <span class="modal-close" id="console-result-close">&times;</span>
                </div>
                <div class="sql-preview-box" style="margin-bottom: 16px;">${res.sql}</div>
                <div class="table-container" style="max-height: 300px; overflow-y: auto;">
                    <table class="db-table">
                        <thead>
                            <tr id="c-res-header"></tr>
                        </thead>
                        <tbody id="c-res-body"></tbody>
                    </table>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" id="console-result-ok-btn">OK</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const headerRow = modal.querySelector('#c-res-header');
        const bodyRow = modal.querySelector('#c-res-body');

        // Headers
        res.columns.forEach(col => {
            const th = document.createElement('th');
            th.innerText = col.replace('_', ' ').toUpperCase();
            headerRow.appendChild(th);
        });

        // Rows
        if (res.rows.length === 0) {
            bodyRow.innerHTML = `<tr><td colspan="${res.columns.length}" style="text-align:center; color: var(--text-muted);">Empty set. (0 rows)</td></tr>`;
        } else {
            res.rows.forEach(row => {
                const tr = document.createElement('tr');
                res.columns.forEach(col => {
                    const td = document.createElement('td');
                    let val = row[col];
                    if ((col === 'balance' || col === 'amount' || col === 'total_deposit' || col === 'total_transaction') && typeof val === 'number') {
                        td.innerText = `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
                        td.style.color = 'white';
                    } else {
                        td.innerText = val;
                    }
                    tr.appendChild(td);
                });
                bodyRow.appendChild(tr);
            });
        }

        const closeFn = () => modal.remove();
        modal.querySelector('#console-result-close').addEventListener('click', closeFn);
        modal.querySelector('#console-result-ok-btn').addEventListener('click', closeFn);
    }

    // --- SETUP INITIAL APP STATE ---
    
    function renderLogs() {
        logsContent.innerHTML = '';
        window.db.sqlLogs.forEach(entry => {
            const el = document.createElement('div');
            el.className = `log-entry ${entry.status.toLowerCase()}`;
            
            let statusSpan = `<span class="log-status success">[SUCCESS]</span>`;
            let errorDiv = '';
            
            if (entry.status === 'ERROR') {
                statusSpan = `<span class="log-status error">[ERROR]</span>`;
                errorDiv = `<div class="log-error-msg">${entry.error}</div>`;
            }

            el.innerHTML = `
                <div class="log-header-info">
                    <span class="log-time">${entry.timestamp || new Date().toLocaleTimeString()}</span>
                    ${statusSpan}
                </div>
                <div class="log-sql">${entry.sql}</div>
                ${errorDiv}
            `;
            logsContent.appendChild(el);
        });
        logsContent.scrollTop = logsContent.scrollHeight;
    }

    // Reset Database button listener
    const resetDbBtn = document.getElementById('reset-db-btn');
    if (resetDbBtn) {
        resetDbBtn.addEventListener('click', async () => {
            if (confirm("Are you sure you want to reset the database? This will clear all modifications and restore the initial seed tables and logs.")) {
                await window.db.resetDatabase();
                
                // Clear and rebuild log console display
                renderLogs();

                // Refresh UI components
                updateDashboardStats();
                initOrUpdateCharts();
                updateDashboardLogs();
                renderActiveTable();
                loadAccountDropdowns();

                // Reset outputs
                const transferOutput = document.getElementById('proc-transfer-output');
                if (transferOutput) transferOutput.style.display = 'none';
                
                const interestOutput = document.getElementById('proc-interest-output-container');
                if (interestOutput) interestOutput.style.display = 'none';
                
                const triggerOutput = document.getElementById('trigger-test-output');
                if (triggerOutput) triggerOutput.style.display = 'none';

                showToast("Database has been reset to original seed state.", "success");
            }
        });
    }

    // Startup async initialization
    (async () => {
        // Fetch real database data and logs
        await window.db.init();

        // Bind triggers & procedures to display SQL logs on startup
        renderLogs();

        // Load first view
        updateDashboardStats();
        initOrUpdateCharts();
        updateDashboardLogs();
        
        // Select first query by default in query hub
        queryCards[0].click();
    })();
});

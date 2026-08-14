/*
 * The three dashboard charts. Data is embedded in the page as JSON by the template, so
 * there is no fetch and no client-side router — the page is already server-rendered.
 */
(function () {
  var node = document.getElementById('dashboard-data');
  if (!node || typeof Chart === 'undefined') return;

  var data = JSON.parse(node.textContent);
  var dark = document.documentElement.classList.contains('dark');
  var grid = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  var text = dark ? '#9ca3af' : '#6b7280';

  // Brand navy for the primary series; the rest are the status hues, reused deliberately
  // so the dashboard never invents a second palette.
  var NAVY = '#213a63';
  var SERIES = ['#213a63', '#2f5590', '#4e77b3', '#7d9ecf', '#aec4e4', '#d97706', '#059669', '#dc2626'];

  Chart.defaults.color = text;
  Chart.defaults.borderColor = grid;
  Chart.defaults.font.family =
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  function money(value) {
    return '$' + Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  var pnl = document.getElementById('chart-pnl');
  if (pnl) {
    new Chart(pnl, {
      type: 'bar',
      data: {
        labels: data.profitAndLoss.labels,
        datasets: [
          { label: 'Income', data: data.profitAndLoss.income, backgroundColor: '#059669', borderRadius: 4 },
          { label: 'Expense', data: data.profitAndLoss.expense, backgroundColor: NAVY, borderRadius: 4 },
        ],
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { callback: money }, grid: { color: grid } },
        },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12 } },
          tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + money(c.parsed.y); } } },
        },
      },
    });
  }

  function doughnut(id, source) {
    var canvas = document.getElementById(id);
    if (!canvas) return;

    new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: source.labels,
        datasets: [{ data: source.values, backgroundColor: SERIES, borderWidth: 0 }],
      },
      options: {
        maintainAspectRatio: false,
        cutout: '58%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12 } },
          tooltip: { callbacks: { label: function (c) { return c.label + ': ' + money(c.parsed); } } },
        },
      },
    });
  }

  doughnut('chart-category', data.expenseByCategory);
  doughnut('chart-department', data.expenseByDepartment);
})();

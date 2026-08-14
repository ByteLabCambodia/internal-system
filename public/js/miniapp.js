/*
 * Telegram Mini App client. Nine screens, no framework, no page loads: the shell stays put
 * and this swaps the <main> contents. Auth is the initData HMAC, sent on every request as
 * the x-telegram-init-data header — there is no cookie in here.
 */
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) tg.ready();

  var initData = tg ? tg.initData : '';
  var screenEl = document.getElementById('screen');
  var titleEl = document.getElementById('screen-title');
  var tabsEl = document.getElementById('tabs');
  var backEl = document.getElementById('back');
  var state = { data: null, stack: [] };

  function api(path, body) {
    return fetch('/api/v1/miniapp/' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-init-data': initData,
      },
      body: JSON.stringify(body || {}),
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok) throw new Error(payload.message || 'Something went wrong');
        return payload;
      });
    });
  }

  function h(html) { screenEl.innerHTML = html; }
  function title(text) { titleEl.textContent = text; }

  var CARD = 'rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800';
  var INPUT = 'block w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white';
  var BUTTON = 'w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white';
  var LABEL = 'mb-1.5 block text-sm font-medium';

  var STATUS_COLOURS = {
    draft: 'bg-gray-100 text-gray-700', cancelled: 'bg-gray-100 text-gray-700',
    pending: 'bg-amber-100 text-amber-800', partial: 'bg-amber-100 text-amber-800',
    approved: 'bg-blue-100 text-blue-800', open: 'bg-blue-100 text-blue-800',
    converted: 'bg-indigo-100 text-indigo-800',
    complete: 'bg-green-100 text-green-800', paid: 'bg-green-100 text-green-800',
    confirmed: 'bg-green-100 text-green-800', fulfilled: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800', unpaid: 'bg-red-100 text-red-800',
  };

  function badge(status) {
    var cls = STATUS_COLOURS[status] || 'bg-gray-100 text-gray-700';
    return '<span class="rounded-md px-2 py-0.5 text-xs font-medium capitalize ' + cls + '">' + status + '</span>';
  }

  function toast(message) {
    if (tg && tg.showAlert) tg.showAlert(message);
    else alert(message);
  }

  // --- screens -------------------------------------------------------------------------
  function screenLink(message) {
    title('Link your account');
    h(
      '<div class="' + CARD + '">' +
      '<p class="mb-4 text-sm text-gray-500 dark:text-gray-400">Sign in once to connect this Telegram account to your profile.</p>' +
      (message ? '<p class="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">' + message + '</p>' : '') +
      '<label class="' + LABEL + '" for="email">Email</label>' +
      '<input id="email" type="email" autocomplete="username" class="' + INPUT + ' mb-3" />' +
      '<label class="' + LABEL + '" for="password">Password</label>' +
      '<input id="password" type="password" autocomplete="current-password" class="' + INPUT + ' mb-4" />' +
      '<button id="link-submit" class="' + BUTTON + '">Link account</button>' +
      '</div>'
    );

    document.getElementById('link-submit').onclick = function () {
      api('link', {
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
      })
        .then(load)
        .catch(function (error) { screenLink(error.message); });
    };
  }

  function screenHome() {
    title(state.data.profile.name || 'Home');
    tabsEl.hidden = false;
    h(
      '<div class="' + CARD + ' mb-3">' +
      '<p class="text-sm text-gray-500 dark:text-gray-400">Signed in as</p>' +
      '<p class="font-medium">' + state.data.profile.name + '</p>' +
      '<p class="text-sm text-gray-500 dark:text-gray-400">' + (state.data.profile.email || '') + '</p>' +
      '</div>' +
      '<div class="grid gap-3">' +
      '<button data-go="pr" class="' + CARD + ' text-left"><span class="font-medium">Raise a purchase request</span><span class="block text-sm text-gray-500">Ask to buy something</span></button>' +
      '<button data-go="stock" class="' + CARD + ' text-left"><span class="font-medium">Request stock</span><span class="block text-sm text-gray-500">Take something already held</span></button>' +
      '<button data-go="claim" class="' + CARD + ' text-left"><span class="font-medium">Claim goods received</span><span class="block text-sm text-gray-500">Confirm a delivery arrived</span></button>' +
      '<button data-go="history" class="' + CARD + ' text-left"><span class="font-medium">My history</span><span class="block text-sm text-gray-500">Requests, claims and stock</span></button>' +
      '</div>'
    );

    Array.prototype.forEach.call(screenEl.querySelectorAll('[data-go]'), function (button) {
      button.onclick = function () { go(button.getAttribute('data-go')); };
    });
  }

  function screenPr() {
    title('Purchase request');
    var currencies = Object.keys(state.data.rates);

    h(
      '<div class="' + CARD + '">' +
      '<label class="' + LABEL + '" for="pr-name">What do you need?</label>' +
      '<input id="pr-name" class="' + INPUT + ' mb-3" />' +
      '<div class="mb-3 grid grid-cols-2 gap-3">' +
      '<div><label class="' + LABEL + '" for="pr-qty">Qty</label><input id="pr-qty" type="number" step="0.0001" value="1" class="' + INPUT + '" /></div>' +
      '<div><label class="' + LABEL + '" for="pr-price">Unit price</label><input id="pr-price" type="number" step="0.0001" value="0" class="' + INPUT + '" /></div>' +
      '</div>' +
      '<label class="' + LABEL + '" for="pr-currency">Currency</label>' +
      '<select id="pr-currency" class="' + INPUT + ' mb-3">' +
      currencies.map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('') +
      '</select>' +
      '<label class="' + LABEL + '" for="pr-note">Note</label>' +
      '<textarea id="pr-note" rows="3" class="' + INPUT + ' mb-4"></textarea>' +
      '<button id="pr-submit" class="' + BUTTON + '">Submit for approval</button>' +
      '</div>'
    );

    document.getElementById('pr-submit').onclick = function () {
      api('pr', {
        currency: document.getElementById('pr-currency').value,
        note: document.getElementById('pr-note').value,
        items: [{
          name: document.getElementById('pr-name').value,
          qty: Number(document.getElementById('pr-qty').value),
          unitPrice: Number(document.getElementById('pr-price').value),
        }],
      })
        .then(function (result) { screenSubmitted(result.number + ' submitted for approval.'); })
        .catch(function (error) { toast(error.message); });
    };
  }

  function screenStock() {
    title('Stock request');
    h(
      '<div class="' + CARD + '">' +
      '<label class="' + LABEL + '" for="stock-item">Item</label>' +
      '<select id="stock-item" class="' + INPUT + ' mb-3">' +
      state.data.items.map(function (item) {
        return '<option value="' + item.id + '">' + item.sku + ' — ' + item.name + ' (' + Number(item.stockQty) + ' ' + item.unit + ')</option>';
      }).join('') +
      '</select>' +
      '<label class="' + LABEL + '" for="stock-qty">Quantity</label>' +
      '<input id="stock-qty" type="number" step="0.0001" value="1" class="' + INPUT + ' mb-3" />' +
      '<label class="' + LABEL + '" for="stock-priority">Priority</label>' +
      '<select id="stock-priority" class="' + INPUT + ' mb-4">' +
      ['low', 'medium', 'high', 'urgent'].map(function (p) {
        return '<option value="' + p + '"' + (p === 'medium' ? ' selected' : '') + '>' + p + '</option>';
      }).join('') +
      '</select>' +
      '<button id="stock-submit" class="' + BUTTON + '">Submit request</button>' +
      '</div>'
    );

    document.getElementById('stock-submit').onclick = function () {
      api('stock', {
        inventoryItemId: Number(document.getElementById('stock-item').value),
        qty: Number(document.getElementById('stock-qty').value),
        priority: document.getElementById('stock-priority').value,
      })
        .then(function () { screenSubmitted('Stock request submitted.'); })
        .catch(function (error) { toast(error.message); });
    };
  }

  function screenClaim() {
    title('Claim goods');

    if (!state.data.poLines.length) {
      h('<div class="' + CARD + '"><p class="text-sm text-gray-500">Nothing is outstanding on any order right now.</p></div>');
      return;
    }

    h(
      '<div class="' + CARD + '">' +
      '<label class="' + LABEL + '" for="claim-line">Order line</label>' +
      '<select id="claim-line" class="' + INPUT + ' mb-3">' +
      state.data.poLines.map(function (line) {
        return '<option value="' + line.id + '">' + line.poNumber + ' — ' + line.name + ' (' + line.outstanding + ' left)</option>';
      }).join('') +
      '</select>' +
      '<label class="' + LABEL + '" for="claim-qty">Quantity received</label>' +
      '<input id="claim-qty" type="number" step="0.0001" value="1" class="' + INPUT + ' mb-4" />' +
      '<button id="claim-submit" class="' + BUTTON + '">Submit claim</button>' +
      '</div>'
    );

    document.getElementById('claim-submit').onclick = function () {
      var lineId = Number(document.getElementById('claim-line').value);
      var line = state.data.poLines.filter(function (l) { return l.id === lineId; })[0];

      api('claim', {
        poItemId: lineId,
        qtyClaimed: Number(document.getElementById('claim-qty').value),
        inventoryItemId: line && line.inventoryItemId ? line.inventoryItemId : undefined,
      })
        .then(function () { screenSubmitted('Claim submitted for confirmation.'); })
        .catch(function (error) { toast(error.message); });
    };
  }

  function screenSubmitted(message) {
    title('Done');
    h(
      '<div class="' + CARD + ' text-center">' +
      '<p class="mb-1 text-lg font-semibold">Submitted</p>' +
      '<p class="mb-4 text-sm text-gray-500 dark:text-gray-400">' + message + '</p>' +
      '<button data-go="home" class="' + BUTTON + '">Back to home</button>' +
      '</div>'
    );
    screenEl.querySelector('[data-go]').onclick = function () { go('home'); };
  }

  function screenHistory() {
    title('History');
    h('<p class="py-10 text-center text-sm text-gray-500">Loading…</p>');

    api('history').then(function (history) {
      function section(heading, rows, render) {
        if (!rows.length) return '';
        return '<h2 class="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">' + heading + '</h2>' +
          '<div class="space-y-2">' + rows.map(render).join('') + '</div>';
      }

      h(
        section('Purchase requests', history.purchaseRequests, function (row) {
          return '<button data-detail="pr:' + row.id + '" class="' + CARD + ' w-full text-left">' +
            '<span class="flex items-center justify-between"><span class="font-medium">' + row.number + '</span>' + badge(row.status) + '</span>' +
            '<span class="block text-sm text-gray-500">' + row.total + '</span></button>';
        }) +
        section('Claims', history.claims, function (row) {
          return '<button data-detail="claim:' + row.id + '" class="' + CARD + ' w-full text-left">' +
            '<span class="flex items-center justify-between"><span class="font-medium">' + row.item + '</span>' + badge(row.status) + '</span>' +
            '<span class="block text-sm text-gray-500">' + Number(row.qty) + ' received</span></button>';
        }) +
        section('Stock requests', history.stockRequests, function (row) {
          return '<button data-detail="stock:' + row.id + '" class="' + CARD + ' w-full text-left">' +
            '<span class="flex items-center justify-between"><span class="font-medium">' + row.item + '</span>' + badge(row.status) + '</span>' +
            '<span class="block text-sm text-gray-500">' + Number(row.qty) + ' requested</span></button>';
        }) ||
        '<p class="py-10 text-center text-sm text-gray-500">Nothing submitted yet.</p>'
      );

      Array.prototype.forEach.call(screenEl.querySelectorAll('[data-detail]'), function (button) {
        button.onclick = function () {
          var parts = button.getAttribute('data-detail').split(':');
          state.stack.push('history');
          screenDetail(parts[0], parts[1]);
        };
      });
    });
  }

  // Approve/Reject, Confirm/Reject, Fulfil/Reject — matched to the record kind. Reused by
  // both the read-only history drill-down and the reviewer deep link the Telegram
  // notification buttons open (?screen=pr&id=5 etc.) — the server decides via `canDecide`
  // whether the buttons should even render; the endpoint re-checks everything regardless.
  var DECIDE_LABELS = {
    pr: { approve: 'Approve', reject: 'Reject' },
    claim: { approve: 'Confirm', reject: 'Reject' },
    stock: { approve: 'Fulfil', reject: 'Reject' },
  };

  function screenDetail(kind, id) {
    title('Details');
    backEl.hidden = false;

    api('history/' + kind + '/' + id).then(function (record) {
      var rows = Object.keys(record)
        .filter(function (key) { return key !== 'items' && key !== 'canDecide' && key !== 'id' && record[key] !== null && record[key] !== ''; })
        .map(function (key) {
          var value = key === 'status' ? badge(record[key]) : record[key];
          return '<div class="flex justify-between border-b border-gray-100 py-2 last:border-0 dark:border-gray-700">' +
            '<span class="text-sm text-gray-500 capitalize">' + key.replace(/([A-Z])/g, ' $1') + '</span>' +
            '<span class="text-sm font-medium">' + value + '</span></div>';
        }).join('');

      var items = (record.items || []).map(function (item) {
        return '<div class="flex justify-between py-1 text-sm"><span>' + item.name + '</span><span>' + Number(item.qty) + ' × ' + Number(item.unitPrice) + '</span></div>';
      }).join('');

      var labels = DECIDE_LABELS[kind] || DECIDE_LABELS.pr;
      var actions = record.canDecide
        ? '<div class="mt-4 grid grid-cols-2 gap-2">' +
          '<button id="decide-approve" class="rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white">' + labels.approve + '</button>' +
          '<button id="decide-reject" class="rounded-lg border border-red-300 px-4 py-2.5 text-sm font-medium text-red-700">' + labels.reject + '</button>' +
          '</div>'
        : '';

      h('<div class="' + CARD + '">' + rows + (items ? '<div class="mt-3 border-t border-gray-100 pt-3 dark:border-gray-700">' + items + '</div>' : '') + '</div>' + actions);

      if (!record.canDecide) return;

      function decide(decision) {
        api('history/' + kind + '/' + id + '/decide', { decision: decision })
          .then(function () { screenDetail(kind, id); })
          .catch(function (error) { toast(error.message); });
      }

      document.getElementById('decide-approve').onclick = function () { decide('approve'); };
      document.getElementById('decide-reject').onclick = function () { decide('reject'); };
    });
  }

  var SCREENS = {
    home: screenHome, pr: screenPr, stock: screenStock,
    claim: screenClaim, history: screenHistory,
  };

  function go(name) {
    backEl.hidden = name === 'home';
    if (name !== 'home') state.stack = ['home'];
    (SCREENS[name] || screenHome)();
  }

  backEl.onclick = function () { go(state.stack.pop() || 'home'); };

  Array.prototype.forEach.call(tabsEl.querySelectorAll('[data-screen]'), function (button) {
    button.onclick = function () { go(button.getAttribute('data-screen')); };
  });

  // Telegram notification buttons open the Mini App with ?screen=pr&id=5 (see
  // NotificationsService.linkFor) so a manager lands directly on the record to review
  // instead of the home screen.
  function deepLink() {
    var params = new URLSearchParams(window.location.search);
    var screen = params.get('screen');
    var id = params.get('id');
    if (!id || ['pr', 'claim', 'stock'].indexOf(screen) === -1) return null;
    return { screen: screen, id: id };
  }

  function load() {
    api('data')
      .then(function (payload) {
        if (!payload.linked) { tabsEl.hidden = true; screenLink(); return; }
        state.data = payload;

        var link = deepLink();
        if (link) {
          tabsEl.hidden = false;
          state.stack = ['home'];
          screenDetail(link.screen, link.id);
          return;
        }

        go('home');
      })
      .catch(function (error) {
        tabsEl.hidden = true;
        h('<div class="' + CARD + '"><p class="text-sm text-red-700">' + error.message + '</p></div>');
      });
  }

  load();
})();

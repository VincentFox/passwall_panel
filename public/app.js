'use strict';

function humanBytes(bytes) {
  var units = ['B', 'KB', 'MB', 'GB', 'TB'];
  var val = Number(bytes) || 0;
  var i = 0;
  while (val >= 1024 && i < units.length - 1) {
    val = val / 1024;
    i++;
  }
  return val.toFixed(i === 0 ? 0 : 2) + ' ' + units[i];
}

function updateUI(data) {
  var total = Number(data.total_bytes || 0);
  var local = Number(data.local_bytes || 0);
  var lan = Number(data.lan_bytes || 0);

  var totalPkts = Number(data.total_packets || 0);
  var localPkts = Number(data.local_packets || 0);
  var lanPkts = Number(data.lan_packets || 0);

  document.getElementById('pw-total').textContent = humanBytes(total);
  document.getElementById('pw-total-sub').textContent = totalPkts + ' packets';
  document.getElementById('pw-lan').textContent = humanBytes(lan);
  document.getElementById('pw-lan-sub').textContent = lanPkts + ' packets';
  document.getElementById('pw-local').textContent = humanBytes(local);
  document.getElementById('pw-local-sub').textContent = localPkts + ' packets';
  document.getElementById('pw-rules').textContent = String(data.rules || 0);
  document.getElementById('pw-backend').textContent = (data.backend || 'unknown') + ' backend';

  document.getElementById('pw-ts').textContent = data.ts || '--';
  document.getElementById('pw-pkts').textContent = totalPkts;
  document.getElementById('pw-local-pkts').textContent = localPkts;
  document.getElementById('pw-lan-pkts').textContent = lanPkts;

  document.getElementById('pw-device').textContent = data.device || '--';
  document.getElementById('pw-ip').textContent = data.ip || '--';
}

function fetchStatus(deviceKey) {
  var url = '/api/status?device=' + encodeURIComponent(deviceKey || 'default');
  return fetch(url).then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }).then(updateUI).catch(function () {
    // keep last values
  });
}

function fetchDevices() {
  return fetch('/api/devices').then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  });
}

function renderDeviceGrid(items, selectedKey) {
  var grid = document.getElementById('pw-device-grid');
  if (!grid) return;
  grid.innerHTML = '';
  var now = Math.floor(Date.now() / 1000);
  (items || []).forEach(function (it) {
    var card = document.createElement('div');
    card.className = 'pw-device-card';
    if (it.key === selectedKey) card.style.borderColor = '#4b6bff';

    var title = document.createElement('div');
    title.className = 'pw-device-title';
    title.textContent = it.device || it.key;

    var meta = document.createElement('div');
    meta.className = 'pw-device-meta';
    meta.textContent = (it.ip ? it.ip + ' · ' : '') + 'last ' + Math.max(0, now - (it.received_at || 0)) + 's ago';

    var status = document.createElement('div');
    status.className = 'pw-device-status';
    var dot = document.createElement('span');
    dot.className = 'pw-dot' + ((now - (it.received_at || 0)) < 120 ? ' online' : '');
    var label = document.createElement('span');
    label.textContent = (now - (it.received_at || 0)) < 120 ? 'online' : 'offline';
    status.appendChild(dot);
    status.appendChild(label);

    var metrics = document.createElement('div');
    metrics.className = 'pw-device-metrics';

    function metric(labelText, valueText) {
      var box = document.createElement('div');
      box.className = 'pw-device-metric';
      var l = document.createElement('div');
      l.className = 'label';
      l.textContent = labelText;
      var v = document.createElement('div');
      v.className = 'value';
      v.textContent = valueText;
      box.appendChild(l);
      box.appendChild(v);
      return box;
    }

    metrics.appendChild(metric('Total', humanBytes(it.total_bytes || 0)));
    metrics.appendChild(metric('LAN', humanBytes(it.lan_bytes || 0)));
    metrics.appendChild(metric('Local', humanBytes(it.local_bytes || 0)));

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(status);
    card.appendChild(metrics);
    card.addEventListener('click', function () {
      var select = document.getElementById('pw-device-select');
      select.value = it.key;
      select.dispatchEvent(new Event('change'));
    });

    grid.appendChild(card);
  });
}

function fetchHistory(deviceKey) {
  var since = Math.floor(Date.now() / 1000) - 24 * 3600;
  var url = '/api/history?device=' + encodeURIComponent(deviceKey || 'default') + '&since=' + since;
  return fetch(url).then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  });
}

function drawChart(points) {
  var canvas = document.getElementById('pw-chart');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var w = canvas.width;
  var h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (!points || points.length === 0) {
    ctx.fillStyle = '#7a8599';
    ctx.fillText('No data', 20, 20);
    return;
  }

  var minT = points[0].t;
  var maxT = points[points.length - 1].t;
  var maxVal = 0;
  points.forEach(function (p) {
    var v = Number(p.total_bytes || 0);
    if (v > maxVal) maxVal = v;
  });
  maxVal = Math.max(maxVal, 1);

  var pad = 30;
  function xFor(t) {
    return pad + (t - minT) / (maxT - minT || 1) * (w - pad * 2);
  }
  function yFor(v) {
    return h - pad - (v / maxVal) * (h - pad * 2);
  }

  ctx.strokeStyle = '#e6eaf2';
  ctx.lineWidth = 1;
  for (var i = 0; i < 5; i++) {
    var y = pad + i * ((h - pad * 2) / 4);
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(w - pad, y);
    ctx.stroke();
  }

  ctx.strokeStyle = '#4b6bff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach(function (p, idx) {
    var x = xFor(p.t);
    var y = yFor(Number(p.total_bytes || 0));
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = '#4b6bff';
  ctx.fillText('Total', pad, pad - 8);
}

function loadConfig() {
  return fetch('/api/config').then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }).then(function (cfg) {
    document.getElementById('cfg-url').value = cfg.router_url || '';
    document.getElementById('cfg-user').value = cfg.router_user || '';
    document.getElementById('cfg-pass').value = '';
    document.getElementById('cfg-interval').value = cfg.interval || 10;
    document.getElementById('cfg-enabled').checked = !!cfg.enabled;
  }).catch(function () {
    // ignore
  });
}

function saveConfig() {
  var payload = {
    router_url: document.getElementById('cfg-url').value.trim(),
    router_user: document.getElementById('cfg-user').value.trim(),
    router_pass: document.getElementById('cfg-pass').value,
    interval: Number(document.getElementById('cfg-interval').value || 10),
    enabled: document.getElementById('cfg-enabled').checked
  };

  return fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  });
}

function pullNow() {
  return fetch('/api/pull', { method: 'POST' }).then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  });
}

function init() {
  var refreshBtn = document.getElementById('pw-refresh');
  var autoToggle = document.getElementById('pw-autorefresh');
  var deviceSelect = document.getElementById('pw-device-select');
  var timer = null;
  var cfgSave = document.getElementById('cfg-save');
  var cfgPull = document.getElementById('cfg-pull');
  var cfgMsg = document.getElementById('cfg-msg');

  function getCurrentDevice() {
    return deviceSelect.value || 'default';
  }

  function startTimer() {
    if (timer) return;
    timer = setInterval(function () {
      var key = getCurrentDevice();
      fetchStatus(key);
      fetchHistory(key).then(drawChart).catch(function () {});
      fetchDevices().then(function (items) {
        renderDeviceGrid(items, key);
      }).catch(function () {});
    }, 4000);
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  refreshBtn.addEventListener('click', function () {
    var key = getCurrentDevice();
    fetchStatus(key);
    fetchHistory(key).then(drawChart).catch(function () {});
  });

  autoToggle.addEventListener('change', function () {
    if (autoToggle.checked) startTimer();
    else stopTimer();
  });

  cfgSave.addEventListener('click', function () {
    cfgMsg.textContent = 'Saving...';
    saveConfig().then(function () {
      cfgMsg.textContent = 'Saved.';
    }).catch(function () {
      cfgMsg.textContent = 'Save failed.';
    });
  });

  cfgPull.addEventListener('click', function () {
    cfgMsg.textContent = 'Pulling...';
    pullNow().then(function (res) {
      if (res && res.ok) {
        cfgMsg.textContent = 'Pulled.';
        var key = getCurrentDevice();
        fetchStatus(key);
      } else {
        cfgMsg.textContent = 'Pull error.';
      }
    }).catch(function () {
      cfgMsg.textContent = 'Pull failed.';
    });
  });

  fetchDevices().then(function (items) {
    deviceSelect.innerHTML = '';
    if (!items || items.length === 0) {
      var opt = document.createElement('option');
      opt.value = 'default';
      opt.textContent = 'default';
      deviceSelect.appendChild(opt);
      return;
    }
    items.forEach(function (it) {
      var opt = document.createElement('option');
      opt.value = it.key;
      opt.textContent = (it.device || it.key) + (it.ip ? ' (' + it.ip + ')' : '');
      deviceSelect.appendChild(opt);
    });
    renderDeviceGrid(items, deviceSelect.value || 'default');
  }).then(function () {
    var key = getCurrentDevice();
    fetchStatus(key);
    fetchHistory(key).then(drawChart).catch(function () {});
  });

  deviceSelect.addEventListener('change', function () {
    var key = getCurrentDevice();
    fetchStatus(key);
    fetchHistory(key).then(drawChart).catch(function () {});
  });

  loadConfig();
  startTimer();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

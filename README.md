# Passwall Panel 部署文档（Docker 面板 + 路由器推送）

本文档面向：OpenWrt 路由器推送统计数据到 Docker 面板，面板展示多设备与 24h 曲线。

## 1. 环境准备

- 一台可运行 Docker 的服务器
- 一台或多台 OpenWrt 路由器（已安装 passwall）
- 路由器已安装：`curl`

## 2. 获取代码（Git）

```bash
git clone https://github.com/VincentFox/passwall_panel.git
cd passwall_panel
```

## 3. 部署面板（Docker）

编辑 `docker-compose.yml`（修改账号密码）：

```yaml
    environment:
      BASIC_USER: passwall
      BASIC_PASS: change_me
```

启动：

```bash
docker compose up -d --build
```

访问面板：

```
http://<服务器IP>:8080
```

浏览器会弹出 Basic Auth 登录框，输入 `BASIC_USER/BASIC_PASS`。

## 4. 路由器侧推送脚本（OpenWrt）

本方案采用“路由器主动推送”的方式。

### 4.1 安装统计脚本
在你的电脑上，把脚本传到路由器（脚本在 router/ 目录）：

```bash
scp router/stat.sh root@<router>:/usr/libexec/passwall-traffic/stat.sh
```
在路由器上执行：
```bash
ssh root@<router> "chmod +x /usr/libexec/passwall-traffic/stat.sh"
```

### 4.2 安装推送脚本

在你的电脑上，把脚本传到路由器（脚本在 `router/` 目录）：

```bash
scp router/openwrt-push-setup.sh root@<router>:/root/
```

在路由器上执行：

```bash
chmod +x /root/openwrt-push-setup.sh
/root/openwrt-push-setup.sh \
  -u http://<panel-ip>:8080/api/ingest \
  -U passwall -P change_me \
  -d ARS2 -i 192.168.1.1 \
  -n 1
```

说明：
- `-n` 为推送间隔（分钟）
- `-d` 设备名称（面板显示）
- `-i` 设备 IP（面板显示）

### 4.3 验证推送

在路由器上执行：

```bash
/usr/bin/passwall-push.sh
```

然后在面板里检查是否出现设备卡片与实时数据。

## 5. 面板功能说明

- 顶部下拉框：选择设备
- Devices 卡片：在线/离线状态 + 三项指标（Total / LAN / Local）
- 24h 曲线：展示近 24 小时流量变化

历史数据位置：

```
/data/devices/<device>.json
```

## 6. 常见问题

### 6.1 面板无数据

检查：
1. 路由器 `curl` 是否可访问面板 `/api/ingest`
2. 面板容器是否正常运行
3. `stat.sh` 是否能正确输出 JSON：

```bash
/usr/libexec/passwall-traffic/stat.sh -j
```

### 6.2 设备显示离线

默认超过 120 秒未上报即视为离线：
- 检查 cron 是否正常执行
- 检查推送脚本是否执行失败

## 7. 升级方式

拉取新代码后重新构建容器：

```bash
cd passwall_panel
docker compose up -d --build
```

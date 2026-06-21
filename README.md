# NetSlim - 进程级网络模拟 CLI

基于 PID 的进程级网络模拟工具，可以针对特定进程进行带宽限制、延迟模拟和丢包控制，而不会影响系统其他进程的网络连接。

## ✨ 特性

- 🎯 **进程级控制** - 只影响指定 PID 的进程，不干扰其他应用
- 🌐 **多平台支持** - Linux (tc + cgroup) 和 macOS (pf + dnctl)
- 📱 **预设网络模板** - 2G、3G、4G、HighPacketLoss 等 14 种预设配置
- ⚙️ **自定义配置** - 支持自定义带宽、延迟、抖动、丢包率
- ♻️ **自动恢复** - Ctrl+C 自动清理所有网络规则
- 🔍 **进程检查** - 实时查看进程网络端口状态

## 🚀 快速开始

### 安装

```bash
npm install
npm run build
npm link
```

### 基本用法

```bash
# 查看可用的网络模板
netslim --list

# 对进程 12345 应用 3G 网络
sudo netslim --pid 12345 --profile 3G

# 对进程 12345 应用高丢包网络，持续 60 秒
sudo netslim --pid 12345 --profile HighPacketLoss --duration 60

# 自定义网络配置
sudo netslim --pid 12345 --profile Custom --download 5 --latency 200 --loss 5

# 检查进程信息和网络端口
netslim --check-pid 12345

# 查看特定模板详情
netslim --show-profile HighPacketLoss
```

## 📋 可用网络模板

| 模板 | 下载 | 上传 | 延迟 | 丢包 |
|------|------|------|------|------|
| **2G** | 256Kbps | 128Kbps | 300ms | 2% |
| **3G** | 2Mbps | 1Mbps | 150ms | 1% |
| **3G-Slow** | 780Kbps | 330Kbps | 200ms | 1% |
| **4G** | 10Mbps | 5Mbps | 50ms | 0.5% |
| **DSL** | 4Mbps | 1Mbps | 40ms | 0.2% |
| **Cable** | 20Mbps | 5Mbps | 20ms | 0.1% |
| **FIOS** | 100Mbps | 100Mbps | 5ms | 0% |
| **HighLatency** | 5Mbps | 2Mbps | 600ms | 0.5% |
| **HighPacketLoss** | 10Mbps | 5Mbps | 50ms | 10% |
| **VeryHighPacketLoss** | 5Mbps | 2Mbps | 100ms | 25% |
| **Flaky** | 8Mbps | 4Mbps | 80ms | 5% |
| **LowBandwidth** | 512Kbps | 256Kbps | 100ms | 1% |
| **Offline** | 0 | 0 | 0ms | 100% |
| **Custom** | 自定义 | 自定义 | 自定义 | 自定义 |

## 🛠️ 技术架构

### Linux 平台

使用 `tc` (traffic control) + `cgroup` + `iptables` 实现：

1. **cgroup net_cls**: 将目标进程加入特定 cgroup，标记网络包
2. **iptables**: 对 cgroup 标记的包设置 fwmark
3. **tc netem**: 根据 fwmark 应用延迟、丢包、抖动等网络模拟
4. **tc htb/tbf**: 根据 fwmark 应用带宽限制

### macOS 平台

使用 `pf` (Packet Filter) + `dnctl` (dummynet) 实现：

1. **端口扫描**: 扫描目标进程的所有 TCP/UDP 端口
2. **dnctl pipe**: 创建虚拟管道配置带宽、延迟、丢包
3. **pf 规则**: 将指定端口的流量重定向到虚拟管道

## 📝 完整选项

```
--pid <number>              目标进程 ID (必需)
-p, --profile <name>        网络模板名称 (必需)
-i, --interface <name>      网络接口 (默认自动检测)
-d, --duration <seconds>    持续时间 (0 表示无限，默认 0)
--download <mbps>           下载速度 (Mbps，覆盖模板)
--upload <mbps>             上传速度 (Mbps，覆盖模板)
--latency <ms>              延迟 (毫秒，覆盖模板)
--jitter <ms>               抖动 (毫秒，覆盖模板)
--loss <percent>            丢包率 (百分比，覆盖模板)
-l, --list                  列出所有网络模板
--show-profile <name>       显示指定模板详情
--check-pid <number>        检查进程信息和端口
-h, --help                  显示帮助
```

## ⚠️ 注意事项

1. **需要 root 权限** - 必须使用 sudo 运行
2. **活动端口** - 进程需要有活跃的网络连接才能生效
3. **子进程** - 自动包含目标进程的所有子进程
4. **macOS 限制** - 不支持数据包损坏和乱序的精确模拟
5. **清理机制** - 异常退出时会自动尝试清理，但建议正常使用 Ctrl+C

## 🔧 开发

```bash
# 安装依赖
npm install

# 编译 TypeScript
npm run build

# 监听模式编译
npm run dev

# 类型检查
npx tsc --noEmit
```

## 📁 项目结构

```
src/
├── types.ts              # 类型定义
├── profiles.ts           # 网络模板配置
├── utils.ts              # 工具函数
├── process.ts            # 进程信息获取
├── controller.ts         # 核心控制器
├── signals.ts            # 信号处理
├── cli.ts                # CLI 入口
├── index.ts              # 导出入口
└── backends/
    ├── index.ts          # 后端管理器
    ├── linux.ts          # Linux 后端 (tc + cgroup)
    └── darwin.ts         # macOS 后端 (pf + dnctl)
```

## 📄 许可证

MIT License

# macOS 手势训练环境

## 1. 激活环境

本机已使用 Python 3.12 创建独立 Conda 环境并安装锁定依赖：

```bash
conda activate wingman-zilo
cd AdvantureX/zilo/hmm_gesture
```

需要重建环境时：

```bash
conda create -n wingman-zilo python=3.12 pip -y
conda activate wingman-zilo
python -m pip install -r requirements.lock
```

## 2. macOS 戒指标识

macOS 的 CoreBluetooth 不使用文档示例中的 BLE MAC 地址，而是使用 UUID。
这个 UUID 会随广播/系统状态变化，不要把一次扫描得到的 UUID 长期写死。
先唤醒戒指并断开手机端连接，再运行：

```bash
python ring_connect.py
```

该工具会固定扫描 12 秒，只显示名称为 `ring` 或名称缺失、且提供以下
NUS Service UUID 的设备。扫描停止后等待蓝牙就绪，再连接并读取系统信息；
失败时会用指数退避重试：

```text
6E400001-B5A3-F393-E0A9-E50E24DCCA9E
```

## 3. 连接前准备

1. 把戒指放在 Mac 附近并唤醒。
2. 确保没有手机 App 或其他 BLE 工具占用戒指连接。
3. 单击戒指按键，将设备切换到手势模式。
4. 读取设备信息，确认不是仅仅“扫描到广播”：

```bash
python ring_connect.py
```

只有上一步输出型号、固件和电量后，才进入采集。

## 4. 采集、训练、识别

记下 `ring_connect.py` 成功输出的最新 UUID。每个手势建议先录制 10 次：

```bash
python record_gesture.py \
  --name 双敲 \
  --ring \
  --address <ring_connect.py 输出的 UUID> \
  --reps 10
```

训练全部已采集手势：

```bash
python train_hmm.py --data gestures --output models
```

实时识别：

```bash
python recognize.py \
  --models pretrained_models \
  --ring \
  --address <ring_connect.py 输出的 UUID> \
  --trigger-gestures 打响指-hmm
```

## 5. 已验证的离线链路

```bash
python train_hmm.py --data sample_data --output /tmp/zilo-model-check
python recognize.py \
  --models pretrained_models \
  --input sample_data/打响指-hmm.json
```

本机验证结果：样例数据成功训练 `6/6` 个模型；`打响指-hmm.json`
中的 5 段数据全部识别为 `打响指-hmm`，置信度为 `0.989–1.000`。

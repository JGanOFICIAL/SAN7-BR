<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gestão de Bluetooth - SAN7 TECNOLOGIA</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: Arial, sans-serif;
        }
        body {
            background: linear-gradient(135deg, #1e3c72, #2a5298);
            color: white;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            text-align: center;
            position: relative;
        }
        .container {
            background: rgba(255, 255, 255, 0.1);
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
            width: 90%;
            max-width: 500px;
        }
        h1 {
            font-size: 22px;
            margin-bottom: 15px;
        }
        button {
            background: #ffcc00;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            font-size: 16px;
            cursor: pointer;
            margin-top: 10px;
            transition: 0.3s;
        }
        button:hover {
            background: #e6b800;
        }
        .devices {
            margin-top: 20px;
            text-align: left;
        }
        .device {
            background: rgba(255, 255, 255, 0.2);
            padding: 10px;
            border-radius: 5px;
            margin-top: 5px;
        }
        .hidden-mark {
            position: absolute;
            bottom: 5px;
            right: 10px;
            font-size: 10px;
            opacity: 0.1;
        }
        .controls {
            margin-top: 15px;
        }
        .controls button {
            margin: 5px;
            background: #f04e30;
            padding: 8px 15px;
        }
        .controls button.active {
            background: #4caf50;
        }
        .floating-button {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #4CAF50;
            padding: 15px 30px;
            border-radius: 50%;
            color: white;
            font-size: 18px;
            cursor: pointer;
            border: none;
            display: none;
        }
        .floating-button:hover {
            background: #45a049;
        }
    </style>
</head>
<body>

    <div class="container">
        <h1>Gestão de Dispositivos Bluetooth</h1>
        <button onclick="scanBluetooth()">Buscar Dispositivos</button>
        <div class="devices" id="deviceList">
            <!-- Dispositivos detectados serão listados aqui -->
        </div>
    </div>

    <div class="hidden-mark">SAN7 TECNOLOGIA</div>

    <button id="downloadButton" class="floating-button" onclick="downloadDeviceInfo()" style="display: none;">Baixar Informações</button>

    <script>
        let connectedDeviceInfo = null;

        async function scanBluetooth() {
            try {
                const device = await navigator.bluetooth.requestDevice({
                    acceptAllDevices: true,
                    optionalServices: ['battery_service', 'device_information']
                });

                const deviceList = document.getElementById('deviceList');
                const deviceItem = document.createElement('div');
                deviceItem.classList.add('device');
                deviceItem.innerHTML = `<strong>Nome:</strong> ${device.name || 'Desconhecido'} <br>
                                        <strong>ID:</strong> ${device.id} <br>
                                        <button onclick="connectToDevice('${device.id}')">Conectar</button>`;
                deviceList.appendChild(deviceItem);

            } catch (error) {
                alert('Erro ao buscar dispositivos Bluetooth: ' + error);
            }
        }

        async function connectToDevice(deviceId) {
            try {
                const device = await navigator.bluetooth.requestDevice({
                    filters: [{ id: deviceId }],
                    optionalServices: ['battery_service', 'device_information']
                });

                const server = await device.gatt.connect();
                alert("Conectado ao dispositivo: " + device.name);

                connectedDeviceInfo = {
                    name: device.name,
                    id: device.id,
                    status: 'Conectado',
                    batteryLevel: null,
                    activations: ['Conexão Estabelecida']
                };

                showControls(device);
                document.getElementById('downloadButton').style.display = 'block'; // Exibe o botão flutuante após a conexão

            } catch (error) {
                alert("Erro ao conectar: " + error);
            }
        }

        function showControls(device) {
            const controls = document.createElement('div');
            controls.classList.add('controls');

            controls.innerHTML = `
                <h3>Funções Básicas</h3>
                <button onclick="getBatteryLevel('${device.id}')">Ver Nível de Bateria</button>
                <button onclick="disconnectDevice('${device.id}')">Desconectar</button>

                <h3>Funções Avançadas</h3>
                <button onclick="forceDisconnect('${device.id}')" class="advanced">Forçar Desconexão</button>
                <button onclick="restartDevice('${device.id}')" class="advanced">Reiniciar</button>
                <button onclick="changeSettings('${device.id}')" class="advanced">Alterar Configurações</button>
            `;

            document.querySelector('.container').appendChild(controls);
        }

        async function getBatteryLevel(deviceId) {
            try {
                const device = await navigator.bluetooth.requestDevice({ filters: [{ id: deviceId }], optionalServices: ['battery_service'] });
                const server = await device.gatt.connect();
                const service = await server.getPrimaryService('battery_service');
                const characteristic = await service.getCharacteristic('battery_level');
                const value = await characteristic.readValue();
                const batteryLevel = value.getUint8(0);
                alert("Nível de bateria: " + batteryLevel + "%");
                connectedDeviceInfo.batteryLevel = batteryLevel; // Atualiza nível de bateria
            } catch (error) {
                alert("Erro ao obter nível de bateria: " + error);
            }
        }

        function disconnectDevice(deviceId) {
            alert("Desconectando dispositivo: " + deviceId);
            connectedDeviceInfo.status = 'Desconectado';
        }

        function forceDisconnect(deviceId) {
            alert("Forçando desconexão do dispositivo: " + deviceId);
        }

        function restartDevice(deviceId) {
            alert("Reiniciando dispositivo: " + deviceId);
        }

        function changeSettings(deviceId) {
            alert("Alterando configurações do dispositivo: " + deviceId);
        }

        function downloadDeviceInfo() {
            const deviceData = JSON.stringify(connectedDeviceInfo, null, 2);
            const blob = new Blob([deviceData], { type: 'application/json' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${connectedDeviceInfo.name || 'Dispositivo'}_informacoes.json`;
            link.click();
        }
    </script>

</body>
</html>

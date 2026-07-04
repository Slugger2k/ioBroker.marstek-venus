## **Marstek Device Open API（Rev 2.0）** 

The Local API is provided “as is” for local use only.Use at your own risk. Marstek is not liable for any damages, data loss, or legal issues caused by your use of the API.You are responsible for lawful and appropriate use. 

## **Ⅰ. Preface：** 

## **Welcome!** 

This document provides an introduction to the Open API for Marstek devices, which is available to device owners and enables integration with third-party systems. 

While Marstek offers an official mobile app and cloud services, this Open API is designed for advanced users who wish to gain greater control over their devices and seamlessly integrate them into other management platforms. 

## **Ⅱ. General Descri tion p** 

Marstek devices communicate with third-party systems over a Local Area Network (LAN). Before using this API, please ensure that: 

1. The Marstek device is properly connected to your home network. 

2. The Open API feature has been enabled via the Marstek mobile app 

Please note that different Marstek models may support only a subset of the commands described in this documentation. Additionally, enabling the Open API may cause certain built-in features of the device to be disabled in order to prevent command conflicts. For detailed information about supported commands and any functional limitations for specific models, please refer to **Chapter 4** of this document. 

## **2.1 Protocol Format** 

The protocol utilizes the JSON format, with commands primarily categorized into query commands, configuration commands, and certain special commands. 

## **Command Format** 

|**Property**|**Type**|**Description**|
|---|---|---|
|id|number<br>or string|An identifier established by the Client.|
|method|string|A Structured value that holds the parameter values to be used<br>during the invocation of the method.|
|params|object|Parameters that the method takes.|



## **Example** 

```
    {
        "id": 0,
        "method": "string",
        "params": {
            "id":0
        }
    }
```

## **Device Response Format** 

|**Property**|**Type**|**Description**|
|---|---|---|
|id|number or string|Identifier of this request.|
|src|string|Name of the source of the request.|
|result|object|Parameters that the method takes.|



## **Error code** 

|**Code**|**MessageMeaning****||
|---|---|---|
|-32700|Parse error|Invalid JSON was received by the server.An error<br>occurred on the server while parsing the JSON text|
|-32600|Invalid Request|The JSON sent is not a valid Request object.|
|-32601|Method not found|The method does not exist / is not available.|
|-32602|Invalid params|Invalid method parameter(s).|
|-32603|Internal error|Internal JSON-RPC error.|
|-32000<br>to<br>-32099|Server error|Reserved for implementation-defined server-errors.|



The remainder of the space is available for application defined errors. 

## **Example response on success** 

```
    {
        "id": 0,
        "src": "device",
        "result": {
            "id":0
        }
    }
```

## **Example response on error** 

```
    {
        "id":   0,
        "src":  "Venus-24215ee580e7",
        "error":    {
            "code": -32700,
            "message":  "Parse error",
            "data": 402
        }
    }
```

## **2.2 API over UDP** 

## **2.2.1 First-Time Use** 

When users first use the Open API service, they need to follow the configuration process below: 

1. Connect the device to power and turn it on; 

2. Use the Marstek APP to connect and bind the device, and configure the WiFi network for thedevice or connect it to the Ethernet; 

3. Enable the device's API feature in the APP, and set the UDP port number. The default port number is 30000, and the recommended port number is between 49152 and 65535. 

After completing the above operations, the Marstek device can normally receive UDP commands from the same local area network. 

## **2.2.2 Discovering Devices** 

To discover Marstek devices within the LAN, a UDP broadcast is utilized. The broadcast content  is as follows: 

```
    {
        "id": 0,
        "method": "Marstek.GetDevice",
        "params": {
            "ble_mac":"0"
        }
    }
```

If there are Marstek devices within the LAN, taking Venus C as an example, the following response will be received 

```
    {
        "id": 0,
        "src": "VenusC-123456789012",
        "result": {
            "device":"VenusC",
            "ver":111,
            "ble_mac":"123456789012",
            "wifi_mac":"123456789012",
            "wifi_name":"MY_HOME",
            "ip":"192.168.1.11"
        }
    }
```

_The device's IP address can be directly obtained from the Marstek APP or the home router. If this_ functionality is to be used on a long-term basis, it is recommended to configure the device with a static* IP address.* 

## **Ⅲ. Components** 

This chapter mainly introduces the components and services supported by the Marstek device. 

## **3.1 Marstek** 

Marstek contains some basic information about the product, and is mainly used for discovering devices and querying basic device information. 

Marstek.GetDevice: Locate Marstek devices on the local area network. 

## **3.1.1 Marstek.GetDevice** 

**Sending** : 

```
    {
        "id": 0,
        "method": "Marstek.GetDevice",
        "params": {
            "ble_mac":"123456789012"
        }
    }
```

## **Response** : 

```
    {
        "id": 0,
        "src": "VenusC-123456789012",
        "result": {
            "device":"VenusC",
            "ver":111,
            "ble_mac":"123456789012",
            "wifi_mac":"012123456789",
            "wifi_name"："MY_HOME",
            "ip":"192.168.1.11"
        }
    }
```

## **3.2 WiFi** 

The WiFi component is mainly used for configuring the device's WiFi and obtaining the device's basic network information. 

Wifi.GetStatus: Obtain the device's basic network information. 

**3.2.1 Wifi.GetStatus** 

**Sending** : 

|**Property (params)**|**Type**|**Description**|
|---|---|---|
|id|_number_|ID of Instance|



**Response** : 

|**Property (result)**|**Type**|**Description**|
|---|---|---|
|id|_number_|ID of Instance|
|wifi_mac|_string_|WiFi MAC|
|ssid|_string or null_|WiFi name|
|rssi|_number_|WiFi signal strength|
|sta_ip|_string or null_|Device IP|
|sta_gate|_string or null_|Gateway|
|sta_mask|_string or null_|Subnet mask|
|sta_dns|_string or null_|DNS|



## **Example:** 

**Sending** : 

```
    {
        "id": 1,
        "method": "Wifi.GetStatus",
        "params": {
            "id": 0
        }
    }
```

## **Response** : 

```
    {
        "id": 1,
        "src": "VenusC-mac",
        "result": {
            "id": 0,
            "wifi_mac": "620b0c877705"
            "ssid":"Hame",
            "rssi": -59,
            "sta_ip":"192.168.137.41",
            "sta_gate":"192.168.137.1",
            "sta_mask":"255.255.255.0",
            "sta_dns":"192.168.137.1"
        }
```

```
    }
```

## **3.3 Bluetooth** 

The BLE (Bluetooth) component can view the Bluetooth-related information of the device. 

BLE.GetStatus: Check the Bluetooth connection status of the device. 

## **3.3.1 BLE.GetStatus** 

## **Sending** 

|**Property (params)**|**Type**|**Description**|
|---|---|---|
|id|_number_|ID of Instance|



## **Response** : 

|**Property (result)**|**Type**|**Description**|
|---|---|---|
|state|_string_|Bluetooth state|
|ble_mac|_string_|Bluetooth MAC|



## **Example** 

## **Sending** : 

```
    {
        "id": 1,
        "method": "BLE.GetStatus",
        "params": {
            "id": 0
        }
    }
```

## **Response** : 

```
    {
        "id": 1,
        "src": "VenusC-mac",
        "result": {
            "id": 0,
            "state":"connect",
            "ble_mac":"50cf14640fac"
        }
    }
```

## **3.4 Battery** 

The Bat (Battery) component contains basic information about the device's battery. 

**Bat** . **GetStatus** : Query the device's battery information and operating status. 

## **3.4.1 Bat.GetStatus** 

**Sending** : 

|**Property (params)**|**Type**|**Description**|
|---|---|---|
|id|_number_|ID of Instance|



**Response** : 

|**property (result)**|**Type**|**Description**|
|---|---|---|
|id|_number_|ID of Instance|
|soc|_string_|soc|
|charg_flag|_boolean_|Charging permission flag|
|dischrg_flag|_boolean_|Discharge permission flag|
|bat_temp|_number or null_|Battery temperature, [°C]|
|bat_capacity|_number or null_|Battery remaining capacity, [Wh]|
|rated_capacity|_number or null_|Battery rated capacity, [Wh]|



## **Example** 

**Sending** : 

```
    {
        "id": 1,
        "method": "Bat.GetStatus",
        "params": {
            "id": 0
        }
    }
```

**Response** : 

```
    {
        "id": 1,
        "src": "VenusC-mac",
        "result": {
            "id": 0,
            "soc": 90,
            "charg_flag": true,
            "dischrg_flag": true,
            "bat_temp": 25.0,
            "bat_capacity": 256.0,
            "rated_capacity": 2560.0
        }
    }
```

## **3.5 PV** 

The PV (Photovoltaic) component contains the photovoltaic information connected to the device. 

**PV** . **GetStatus** : Query the device's connected photovoltaic information and power generation status. 

## **3.5.1 PV.GetStatus** 

**Sending** : 

|**property (params)**|**Type**|**Description**|
|---|---|---|
|id|_number_|ID of Instance|



**Response** : 

|**Property (result)**|**Type**|**Description**|
|---|---|---|
|id|_number_|ID of Instance|
|pv_power|_number_|Photovoltaic charging power, [W]|
|pv_voltage|_number_|Photovoltaic charging voltage, [V]|
|pv_current|_number_|Photovoltaic charging current, [A]|
|PV_state|_number_|Photovoltaic status 1:Work 0:Standby|



## **Example** ： 

```
    {
        "id": 1,
        "method": "PV.GetStatus",
        "params": {
            "id": 0
        }
    }
```

**Response** : 

```
    {
        "id": 1,
        "src": "VenusC-mac",
        "result": {
            "id": 0,
            "pv1_power":    0,
            "pv1_voltage":  10,
            "pv1_current":  0,
            "pv1_state":    0,
            "pv2_power":    0,
            "pv2_voltage":  9,
            "pv2_current":  0,
            "pv2_state":    0,
            "pv3_power":    0,
            "pv3_voltage":  10,
            "pv3_current":  0,
            "pv3_state":    0,
            "pv4_power":    0,
            "pv4_voltage":  10,
            "pv4_current":  0,
            "pv4_state":    0
        }
    }
```

## **3.6 ES** 

The ES (Energy System) component contains the device's basic power information and energy statistics, and can configure or monitor the device's operating status. 

1. ES.GetStatus: Query the device's basic electrical energy information. 

2. ES.SetMode: Configure the device's operating mode. 

3. ES.GetMode: Get information about the operating mode of the device. 

## **3.6.1 ES.GetStatus** 

**Sending** : 

|**Property (params)**|**Type**|**Description**|
|---|---|---|
|id|_number or null_|ID of Instance|



**Response** : 

|**Property (result)**|**Type**|**Description**|
|---|---|---|
|id|_number or_<br>_null_|ID of Instance|
|bat_soc|_number or_<br>_null_|Total battery SOC，[%]|



|**Property (result)**|**Type**|**Description**|
|---|---|---|
|bat_cap|_number or_<br>_null_|Total battery capacity, [Wh]|
|pv_power|_number or_<br>_null_|Solar charging power, [W]|
|ongrid_power|_number or_<br>_null_|Grid-tied power, [W]|
|offgrid_power|_number or_<br>_null_|Off-grid power, [W]|
|bat_power|_number or_<br>_null_|Battery power, [W]|
|total_pv_energy|_number or_<br>_null_|Total solar energy generated, [Wh]|
|total_grid_output_energy|_number or_<br>_null_|Total grid output energy, [Wh]|
|total_grid_input_energy|_number or_<br>_null_|Total grid input energy, [Wh]|
|total_load_energy|_number or_<br>_null_|Total load (or off-grid) energy consumed,<br>[Wh]|



## **Example** ： 

## **Sending** : 

```
    {
        "id": 1,
        "method": "ES.GetStatus",
        "params": {
            "id": 0
        }
    }
```

## **Response** : 

```
    {
        "id": 1,
        "src": "VenusE-24215edb178f",
        "result": {
            "id": 0,
            "bat_soc": 98,
            "bat_cap": 5120,
            "pv_power": 0,
            "ongrid_power": 100,
            "offgrid_power": 0,
            "total_pv_energy": 0,
            "total_grid_output_energy": 2548,
```

```
            "total_grid_input_energy": 3273,
```

```
            "total_load_energy": 0
        }
    }
```

## **3.6.2 ES.SetMode** 

**Sending** : 

|**Property (params)**|**Type**|**Description**|
|---|---|---|
|id|number|ID of Instance|
|config|object|Config Parameters|



## **Object: config** 

|**Property**<br>**(config)**|**Type**|**Description**|
|---|---|---|
|mode|_string_|Device power generation mode, including the following<br>："Auto"；"AI"；"Manual"；"Passive"; "Ups".|
|auto_cfg|_object_|Configuration parameters for Auto mode|
|ai_cfg|_object_|Configuration parameters for AI mode|
|manual_cfg|_object_|Configuration parameters for Manual mode|
|passive_cfg|_object_|Configuration parameters for Passive mode|
|ups_cfg|_object_|Configuration parameters for Ups mode|



## **Object: auto_cfg** 

|**Property (auto_cfg)**|**Type**|**Description**|
|---|---|---|
|enable|number|ON: 1; OFF: Set another mode|



## **Object: ai_cfg** 

|**Property (ai_cfg)**|**Type**|**Description**|
|---|---|---|
|enable|number|ON: 1; OFF: Set another mode|



## **Object: manual_cfg** 

|**Property**<br>**(manual_cfg)**|**Type**|**Description**|
|---|---|---|
|time_num|number|Time period serial number, Venus C/E supports 0-9|
|start_time|_string_|Start time, hours: minutes, [hh:mm]|



|**Property**<br>**(manual_cfg)**|**Type**|**Description**|
|---|---|---|
|end_time|_string_|End time, hours: minutes, [hh:mm]|
|week_set|number|Week, a byte 8 bits, the low 7 bits effective, the highest nvalid,<br>0000 0001 (1) on behalf of Monday open, 0000 0011 (3) on<br>behalf of Monday and Tuesday open,|
|power|number|Setting power,[W]|
|enable|number|ON: 1; OFF: 0|



## **Object: passive_cfg** 

|**Property (passive_cfg)**|**Type**|**Description**|
|---|---|---|
|power|number|Setting power,[W]|
|cd_time|number|Power countdown,[s]|



## **Object: ups_cfg** 

|**Property (ups_cfg)**|**Type**|**Description**|
|---|---|---|
|enable|number|ON: 1; OFF: 0|



## **Response** ： 

|**Property（result）**|**Type**|**Description**|
|---|---|---|
|id|number|ID of Instance|
|set_result|boolean|"true":succeeded in setting; "false":failed in setting|



**Example*** *：** 

## **Sending** : 

```
/* Auto Mode Example */
{
    "id": 1,
    "method": "ES.SetMode",
    "params": {
        "id": 0,
        "config": {
            "mode": "Auto",
            "auto_cfg": {
                "enable": 1
            }
        }
    }
}
```

```
/* AI Mode Example */
{
    "id": 1,
    "method": "ES.SetMode",
    "params": {
        "id": 0,
        "config": {
            "mode": "AI",
            "ai_cfg": {
                "enable": 1
            }
        }
    }
}
/* Manual Mode Example */
{
    "id": 1,
    "method": "ES.SetMode",
    "params": {
        "id": 0,
        "config": {
            "mode": "Manual",
            "manual_cfg": {
                "time_num": 1,
                "start_time": "08:30",
                "end_time": "20:30",
                "week_set": 127,
                "power": 100,
                "enable": 1
            }
        }
    }
}
/* Passive Pattern Example */
{
    "id": 1,
    "method": "ES.SetMode",
    "params": {
        "id": 0,
        "config": {
            "mode": "Passive",
            "passive_cfg": {
                "power": 100,
                "cd_time": 300
            }
        }
    }
}
/* UPS Mode Example */
{
  "id": 1,
  "method": "ES.SetMode",
```

```
  "params": {
    "id": 0,
    "config": {
      "mode": "UPS",
      "ups_cfg": {
          "enable": 1
      }
    }
  }
}
```

**Response** : 

```
    {
        "id": 1,
        "src": "Venus-mac",
        "result": {
            "id": 0,
            "set_result": ture
        }
    }
```

## **3.6.3 ES.GetMode** 

**Sending** : 

|**Property (params)**|**Type**|**Description**|
|---|---|---|
|id|_number or null_|ID of Instance|



**Response** : 

|**Property**<br>**(result)**|**Type**|**Description**|
|---|---|---|
|id|_number_<br>_or null_|ID of Instance|
|mode|_number_<br>_or null_|Auto：Auto mode; AI: AI mode; Manual: manual mode;<br>Passive: Passive control mode|
|ongrid_power|_number_<br>_or null_|Grid-tied power, [W]|
|offgrid_power|_number_<br>_or null_|Off-grid power, [W]|
|bat_soc|_number_<br>_or null_|SOC，[%]|
|ct_state|_number_<br>_or null_|CT Status，0: Not connected; 1: Connected. Note: Effective in<br>Auto mode and AI mode.|



|**Property**<br>**(result)**|**Type**|**Description**|
|---|---|---|
|a_power|_number_<br>_or null_|Phase A Power, [W] Note: Effective in Auto mode and AI<br>mode|
|b_power|_number_<br>_or null_|Phase B Power, [W] Note: Effective in Auto mode and AI<br>mode|
|c_power|_number_<br>_or null_|Phase C Power, [W] Note: Effective in Auto mode and AI<br>mode|
|total_power|_number_<br>_or null_|CT total power, [W] Note: Effective in automatic mode and AI<br>mode|
|input_energy|_number_<br>_or null_|Cumulative Input Energy [Wh]（*0.1）Note: Effective in<br>automatic mode and AI mode|
|output_energy|_number_<br>_or null_|Total cumulative output energy [Wh]（*0.1）Note: Effective<br>in automatic mode and AI mode|



## **Example** ： 

## **Sending** : 

```
    {
        "id": 1,
        "method": "ES.GetMode",
        "params": {
            "id": 0
        }
    }
```

## **Response** : 

```
    {
        "id": 1,
        "src": "VenusE-24215edb178f",
        "result": {
            "id": 0,
            "mode": "Auto",
            "ongrid_power": 100,
            "offgrid_power": 0,
            "bat_soc": 98,
            "ct_state": 0,
            "a_power":  0,
            "b_power":  0,
            "c_power":  0,
            "total_power":  0
            "input_energy": 3086320,
            "output_energy": 4487510
        }
    }
```

## **3.7 EM** 

The Energy Meter (EM) module contains status information and power measurement data from  the energy meter, or data obtained from the current transformer (CT). 

EM.GetStatus: Queries the basic status and data information of the energy meter. 

## **3.7.1 EM.GetStatus** 

**Sending** : 

|**Property (params)**|**Type**|**Description**|
|---|---|---|
|id|_number or null_|ID of Instance|



**Response** ： 

|**Property**<br>**(result)**|**Type**|**Description**|
|---|---|---|
|id|_number or_<br>_null_|ID of Instance|
|ct_state|_number or_<br>_null_|CT (Current Transformer) status: 0: Not connected 1:<br>Connected|
|a_power|_number or_<br>_null_|Phase A power,[W]|
|b_power|_number or_<br>_null_|Phase B power,[W]|
|c_power|_number or_<br>_null_|Phase C power,[W]|
|total_power|_number or_<br>_null_|Total power,[W]|
|input_energy|_number or_<br>_null_|Cumulative Input Energy [Wh]（*0.1）|
|output_energy|_number or_<br>_null_|Total cumulative output energy [Wh]（*0.1）|



## **Sending** : 

```
    {
        "id": 1,
        "method": "EM.GetStatus",
        "params": {
            "id": 0
        }
    }
```

**Response** : 

```
{
    "id":   1,
    "src":  "VenusD-009b08a5ac28",
    "result":   {
        "id":   0,
        "ct_state": 1,
        "a_power":  0,
        "b_power":  0,
        "c_power":  0,
        "total_power":  0,
        "input_energy": 0,
        "output_energy":    0
    }
}
```

## **3.8 DOD** 

This chapter contains the DOD configuration instructions. The device's default DOD value is 88, with a setting range of 30-88. 

**Sending** : 

|**Property (params)**|**Type**|**Description**|
|---|---|---|
|id|_number or null_|ID of Instance|
|Value|number|DOD Value (range 30-88)|



## **Response** ： 

|**Property（result）**|**Type**|**Description**|
|---|---|---|
|id|number|ID of Instance|
|set_result|boolean|true：Success false：fail|



**Sending** : 

```
    {
        "id": 0,
        "method": "DOD.SET",
        "params": {
            "value": 36
            }
    }
```

## **Response** ： 

```
    {
        "id": 1,
        "src": "Venus-mac",
        "result": {
            "id": 0,
            "set_result": ture
        }
    }
```

## **3.9 Ble_block** 

This chapter covers the Bluetooth lock feature, including turning Bluetooth broadcasting on and off. 

## **Sending** : 

|**Property (params)**|**Type**|**Description**|
|---|---|---|
|id|_number or null_|ID of Instance|
|enable|number|0：enable 1：disable|



## **Sending** : 

```
    {
        "id": 0,
        "method": "Ble.Adv",
        "params": {
            "enable": 0
            }
    }
```

## **Response** ： 

```
{
    "id": 1,
    "src": "Venus-mac",
    "result": {
        "id": 0,
        "set_result": ture
    }
}
```

## **3.10 Led_Ctrl** 

This chapter covers the LED functions of the switchgear panel: 

## **Sending** : 

**Property (params) Type Description** 

|**Property (params)**|**Type**|**Description**|
|---|---|---|
|id|_number or null_|ID of Instance|
|state|number|1：on 0：off|



## **Sending** : 

```
    {
      "id": 0,
      "method": "Led.Ctrl",
          "params": {
            "state": 0
          }
    }
```

## **Response** ： 

```
    {
        "id": 1,
        "src": "Venus-mac",
        "result": {
            "id": 0,
            "set_result": ture
        }
    }
```

## **IV . Devices** 

This chapter will describe the extent of support for the components and services in this API documentation by different Marstek devices, as well as some proprietary information. 

## **4.1 Venus C/E** 

1. Marstek 

2. WiFi 

3. Bluetooth 

4. Battery 

5. ES 

6. EM 

7. DOD 

8. Ble_block 

9. Led_Ctrl 

## **4.2 Venus D** / **Venus A** 

1. Marstek 

2. WiFi 

3. Bluetooth 

4. Battery 

5. PV 

6. ES 

7. EM 

8. DOD 

9. Ble_Ctrl 

10. Led_Ctrl 

## **V . Chan e Lo s g g** 

This chapter explains the change log for the API documentation. 

- 2025-08-09Modified: Version number Rev 1.0 

- 2026-01-06Modified: Version number Rev 2.0 


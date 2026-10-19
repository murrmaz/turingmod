// TuringMod reference firmware, protocol 1: the connection only.
//
// Serves the WebSocket TuringMod connects to, answers its hello, and forwards anything typed into
// the Serial Monitor to TuringMod as a `log` message, which shows in TuringMod's activity feed.
// No servo code yet: see firmware/README.md for the protocol, including the `play` message
// planned next.
//
// Board: ESP32 (any Wi-Fi ESP32 board in the Arduino IDE's "esp32" board package).
// Libraries (Library Manager):
//   - "WebSockets" by Markus Sattler (Links2004/arduinoWebSockets)
//   - "ArduinoJson" by Benoit Blanchon, version 7

#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <WebSocketsServer.h>
#include <WiFi.h>

const char *WIFI_SSID = "your-network";
const char *WIFI_PASSWORD = "your-password";

// Reachable as turingmod-arm.local, which is TuringMod's default address for the board.
const char *HOSTNAME = "turingmod-arm";
const uint16_t PORT = 81;

const int PROTOCOL = 1;
const char *FIRMWARE = "0.1.0";
const int SERVO_COUNT = 0;  // none driven yet

WebSocketsServer server(PORT);

// The connected TuringMod, or -1. One at a time: a new connection replaces the old one, which
// happens when TuringMod restarts before the board noticed the old connection had gone.
int client = -1;
// Whether that TuringMod has had its hello answered. Nothing else is sent before then.
bool greeted = false;

void sendMessage(JsonDocument &message) {
  if (client < 0) {
    return;
  }
  String text;
  serializeJson(message, text);
  server.sendTXT(client, text);
}

void answerHello() {
  JsonDocument reply;
  reply["type"] = "hello";
  reply["protocol"] = PROTOCOL;
  reply["name"] = HOSTNAME;
  reply["firmware"] = FIRMWARE;
  reply["servos"] = SERVO_COUNT;
  sendMessage(reply);
  greeted = true;
}

void onWebSocketEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      if (client >= 0 && client != num) {
        server.disconnect(client);
      }
      client = num;
      greeted = false;
      Serial.println("TuringMod connected");
      break;

    case WStype_DISCONNECTED:
      if (num == client) {
        client = -1;
        greeted = false;
        Serial.println("TuringMod disconnected");
      }
      break;

    case WStype_TEXT: {
      JsonDocument message;
      if (deserializeJson(message, (const char *)payload, length)) {
        Serial.println("Ignored a message that isn't JSON");
        return;
      }
      const char *messageType = message["type"] | "";
      if (strcmp(messageType, "hello") == 0) {
        // Answered whatever protocol TuringMod speaks: TuringMod compares the versions and
        // reports a mismatch itself.
        answerHello();
      } else {
        Serial.printf("Ignored a message of unknown type '%s'\n", messageType);
      }
      break;
    }

    default:
      // Pings are answered by the library; nothing else needs handling.
      break;
  }
}

void setup() {
  Serial.begin(115200);

  WiFi.mode(WIFI_STA);
  WiFi.setHostname(HOSTNAME);
  // Wi-Fi power saving delays incoming messages by up to a few hundred milliseconds.
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\nConnected: ws://%s:%u (or ws://%s.local:%u)\n",
                WiFi.localIP().toString().c_str(), PORT, HOSTNAME, PORT);

  if (MDNS.begin(HOSTNAME)) {
    MDNS.addService("ws", "tcp", PORT);
  } else {
    Serial.println("mDNS failed to start: use the IP address in TuringMod instead");
  }

  server.begin();
  server.onEvent(onWebSocketEvent);
}

void loop() {
  server.loop();

  // Each line typed into the Serial Monitor goes to TuringMod as a `log` message.
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.length() > 0) {
      if (client < 0 || !greeted) {
        Serial.println("Not sent: TuringMod isn't connected");
      } else {
        JsonDocument message;
        message["type"] = "log";
        message["text"] = line;
        sendMessage(message);
      }
    }
  }
}

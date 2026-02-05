const int LED_PIN = 3; // built-in LED on most Arduinos

// void setup() {
//     Serial.begin(9600);
//     pinMode(LED_PIN, OUTPUT);
//     digitalWrite(LED_PIN, LOW);
// }

// void loop() {
//     // check if data received from Python
//     if (Serial.available() > 0) {
//         char received = Serial.read();

//         if (received == '1') {
//             digitalWrite(LED_PIN, HIGH);
//         }
//         else if (received == '0') {
//             digitalWrite(LED_PIN, LOW);
//         }
//     }
// }

#include <Servo.h>

Servo myservo;  // create Servo object to control a servo

int potpin = A0;  // analog pin used to connect the potentiometer
int val;    // variable to read the value from the analog pin

void setup() {
  myservo.attach(9);  // attaches the servo on pin 9 to the Servo object
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
    if (Serial.available() > 0) {
        char received = Serial.read();

        if (received == '1') {
            myservo.write(received * 100);  
            digitalWrite(LED_PIN, HIGH); 
        }
        else if (received == '0') {
            myservo.write(0);
            digitalWrite(LED_PIN, HIGH);
        }
    }
}
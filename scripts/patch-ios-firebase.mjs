import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const packagePath = resolve('ios', 'App', 'CapApp-SPM', 'Package.swift')
let source = readFileSync(packagePath, 'utf8')

if (!source.includes('firebase-ios-sdk')) {
  source = source.replace(
    '        .package(name: "CapacitorPushNotifications", path: "..\\..\\..\\node_modules\\@capacitor\\push-notifications")',
    '        .package(name: "CapacitorPushNotifications", path: "..\\..\\..\\node_modules\\@capacitor\\push-notifications"),\n        .package(url: "https://github.com/firebase/firebase-ios-sdk.git", exact: "12.14.0")',
  )
}

if (!source.includes('.product(name: "FirebaseCore"')) {
  source = source.replace(
    '                .product(name: "CapacitorPushNotifications", package: "CapacitorPushNotifications")',
    '                .product(name: "CapacitorPushNotifications", package: "CapacitorPushNotifications"),\n                .product(name: "FirebaseCore", package: "firebase-ios-sdk"),\n                .product(name: "FirebaseMessaging", package: "firebase-ios-sdk")',
  )
}

writeFileSync(packagePath, source)

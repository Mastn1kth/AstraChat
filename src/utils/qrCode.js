let qrCodePromise = null

async function loadQrCode() {
  if (!qrCodePromise) {
    qrCodePromise = import('qrcode')
  }
  return qrCodePromise
}

export async function createQrDataUrl(value, options) {
  const QRCode = await loadQrCode()
  return QRCode.toDataURL(value, options)
}

import { MCC_RISK } from "./mccRisk.js"
import { NORMALIZATION } from "./normalization.js"

export function limit(v) {
    if (v !== v) return 0  // NaN → 0
    return v < 0 ? 0 : v > 1 ? 1 : v
}

// Buffer estático reutilizado por request (Node.js é single-threaded, sem race condition)
const _vec = new Float32Array(14)

export function createVector(json) {
    const tx    = json.transaction     ?? {}
    const cust  = json.customer        ?? {}
    const term  = json.terminal        ?? {}
    const merch = json.merchant        ?? {}
    const lastTx = json.last_transaction

    let hourVal = 0, dayVal = 0, currentTs = 0
    if (tx.requested_at) {
        const d = new Date(tx.requested_at)
        hourVal   = d.getHours() / 23
        dayVal    = d.getDay() / 6
        currentTs = d.getTime()
    }

    let minutesSinceLast = -1, kmFromLast = -1
    if (lastTx != null) {
        minutesSinceLast = limit(((currentTs - Date.parse(lastTx.timestamp)) / 60000) / NORMALIZATION.max_minutes)
        kmFromLast       = limit((lastTx.km_from_current ?? 0) / NORMALIZATION.max_km)
    }

    const amount = tx.amount ?? 0
    _vec[0]  = limit(amount / NORMALIZATION.max_amount)
    _vec[1]  = limit((tx.installments ?? 0) / NORMALIZATION.max_installments)
    _vec[2]  = limit(amount / ((cust.avg_amount || 1) * NORMALIZATION.amount_vs_avg_ratio))
    _vec[3]  = hourVal
    _vec[4]  = dayVal
    _vec[5]  = minutesSinceLast
    _vec[6]  = kmFromLast
    _vec[7]  = limit((term.km_from_home ?? 0) / NORMALIZATION.max_km)
    _vec[8]  = limit((cust.tx_count_24h ?? 0) / NORMALIZATION.max_tx_count_24h)
    _vec[9]  = term.is_online    === true ? 1 : 0
    _vec[10] = term.card_present === true ? 1 : 0
    _vec[11] = cust.known_merchants?.includes(merch.id) ? 0 : 1
    _vec[12] = MCC_RISK.get(merch.mcc) ?? 0.5
    _vec[13] = limit((merch.avg_amount ?? 0) / NORMALIZATION.max_merchant_avg_amount)

    return _vec
}

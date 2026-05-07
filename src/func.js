import { MCC_RISK } from "./mccRisk.js"
import { NORMALIZATION } from "./normalization.js"

export function limit(valor) {
    if (valor == null || valor == undefined) return -1
    if (valor > 1) return 1.0
    if (valor < 0) return 0.0

    return Number(valor.toFixed(4))
}

function hour(date) {
    const dateTime = new Date(date)
    return dateTime.getHours()
}

function dayWeek(date) {
    const dateTime = new Date(date)
    return dateTime.getDay()
}

function minutes(date) {
    const dateTime = new Date(date)
    return dateTime.getMinutes()
}

export function createVector(json) {

    const amount = limit(json.transaction.amount / NORMALIZATION.max_amount)
    const installments = limit(json.transaction.installments / NORMALIZATION.max_installments)
    const amount_vs_avg = limit((json.transaction.amount / json.customer.avg_amount) / NORMALIZATION.amount_vs_avg_ratio)
    const hour_of_day = limit(hour(json.transaction.requested_at) / 23)
    const day_of_week = dayWeek(json.transaction.requested_at) / 6
    const minutes_since_last_tx = json.last_transaction == null ? -1 : minutes(json.last_transaction.timestamp) / NORMALIZATION.max_minutes
    const km_from_last_tx = json.last_transaction == null ? -1 : limit(json.last_transaction.km_from_current / NORMALIZATION.max_km)
    const km_from_home = limit(json.terminal.km_from_home / NORMALIZATION.max_km)
    const tx_count_24h = limit(json.customer.tx_count_24h / NORMALIZATION.max_tx_count_24h)
    const is_online = json.terminal.is_online == true ? 1 : 0
    const card_present = json.terminal.card_present == true ? 1 : 0
    const unknown_merchant = json.customer.known_merchants?.find(item => item == json.merchant.id) ? 0 : 1
    const mcc_risk = MCC_RISK[json.marchant?.mcc] ?? 0.5
    const merchant_avg_amount = limit(json.merchant.avg_amount / NORMALIZATION.max_merchant_avg_amount)

    return [
        amount, 
        installments, 
        amount_vs_avg, 
        hour_of_day, 
        day_of_week, 
        minutes_since_last_tx, 
        km_from_last_tx, 
        km_from_home, 
        tx_count_24h, 
        is_online, 
        card_present, 
        unknown_merchant, 
        mcc_risk, 
        merchant_avg_amount
    ]
}



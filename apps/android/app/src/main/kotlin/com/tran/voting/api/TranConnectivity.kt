package com.tran.voting.api

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network

/**
 * Calls [onNetwork] each time the device gains a usable default network, so a connectivity banner
 * can probe at once instead of waiting for the next scheduled probe (REQ-ERR-013). Returns the
 * function that stops listening.
 */
fun listenForConnectivity(context: Context, onNetwork: () -> Unit): () -> Unit {
    val manager = context.getSystemService(ConnectivityManager::class.java) ?: return {}
    val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = onNetwork()
    }
    manager.registerDefaultNetworkCallback(callback)
    return { manager.unregisterNetworkCallback(callback) }
}

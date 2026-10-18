package com.tran.voting.core.architecture

import androidx.compose.runtime.Composable

/**
 * A sealed hierarchy representing an asynchronous resource state in Jetpack Compose.
 * Equivalent to iOS `Loadable<T>` and Element X Android's `AsyncData<T>`.
 */
sealed interface AsyncData<out T> {
    data object Uninitialized : AsyncData<Nothing>

    data class Loading<out T>(val previousData: T? = null) : AsyncData<T>

    data class Success<out T>(val data: T) : AsyncData<T>

    data class Failure(val error: Throwable) : AsyncData<Nothing>

    val valueOrNull: T?
        get() = when (this) {
            is Success -> data
            is Loading -> previousData
            Uninitialized, is Failure -> null
        }

    val isLoading: Boolean
        get() = this is Loading

    val isSuccess: Boolean
        get() = this is Success

    fun <R> map(transform: (T) -> R): AsyncData<R> {
        return when (this) {
            Uninitialized -> Uninitialized
            is Loading -> Loading(previousData?.let(transform))
            is Success -> Success(transform(data))
            is Failure -> Failure(error)
        }
    }
}

/**
 * Clean helper function for rendering AsyncData states inside Composables.
 */
@Composable
fun <T> AsyncData<T>.Render(
    onLoading: @Composable (previous: T?) -> Unit,
    onSuccess: @Composable (data: T) -> Unit,
    onFailure: @Composable (error: Throwable) -> Unit,
    onUninitialized: @Composable () -> Unit = {}
) {
    when (this) {
        AsyncData.Uninitialized -> onUninitialized()
        is AsyncData.Loading -> onLoading(previousData)
        is AsyncData.Success -> onSuccess(data)
        is AsyncData.Failure -> onFailure(error)
    }
}

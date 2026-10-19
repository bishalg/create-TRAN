package com.tran.voting.ui.atoms

import androidx.compose.ui.unit.Dp
import com.tran.voting.generated.TranSpace

/**
 * Named gap steps from the generated spacing scale (`tokens.rs` → `TranSpace`).
 * Names match the web scale (`xxs…2xl`; `XXL` is the Kotlin-safe spelling of the web `2xl`).
 * The vocabulary is pinned to `tokens.json` by `native-atoms.test.ts`.
 */
enum class TranGap(val value: Dp) {
    XXS(TranSpace.xxs),
    XS(TranSpace.xs),
    SM(TranSpace.sm),
    BASE(TranSpace.base),
    MD(TranSpace.md),
    LG(TranSpace.lg),
    XL(TranSpace.xl),
    XXL(TranSpace.xxl),
}

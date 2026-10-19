package com.tran.voting.ui.atoms

import androidx.compose.runtime.staticCompositionLocalOf
import com.tran.voting.generated.BrandPalette
import com.tran.voting.generated.TranBrandTokens
import com.tran.voting.generated.TranTheme

/**
 * Atoms read the active palette from the composition, mirroring the web layer where tokens arrive
 * as CSS variables instead of props. `MainActivity` provides the registry palette once.
 */
val LocalTranPalette = staticCompositionLocalOf { TranBrandTokens.palette(TranTheme.DARK) }

package com.tran.voting.ui.atoms

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.Dp
import com.tran.voting.generated.TranRadius
import com.tran.voting.generated.TranSpace

/**
 * Full-screen container: palette background, safe drawing insets, and resource-id export so
 * `testTag` values stay queryable from Maestro (mirrors the iOS `TranScreen` atom).
 */
@Composable
fun TranScreen(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val palette = LocalTranPalette.current
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.background)
            .safeDrawingPadding()
            .semantics { testTagsAsResourceId = true }
            .then(modifier),
        content = content,
    )
}

/** Vertical stack with a named gap step from the generated scale. */
@Composable
fun TranStack(
    gap: TranGap = TranGap.MD,
    modifier: Modifier = Modifier,
    horizontalAlignment: Alignment.Horizontal = Alignment.Start,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(gap.value),
        horizontalAlignment = horizontalAlignment,
        content = content,
    )
}

/** Horizontal row with a named gap step. */
@Composable
fun TranInline(
    gap: TranGap = TranGap.SM,
    modifier: Modifier = Modifier,
    verticalAlignment: Alignment.Vertical = Alignment.CenterVertically,
    content: @Composable RowScope.() -> Unit,
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(gap.value),
        verticalAlignment = verticalAlignment,
        content = content,
    )
}

/** Padding wrapper with token steps (web `TranBox` padding union). */
enum class TranBoxPadding(val value: Dp?) {
    NONE(null),
    SM(TranSpace.sm),
    MD(TranSpace.md),
    LG(TranSpace.lg),
}

@Composable
fun TranBox(
    padding: TranBoxPadding = TranBoxPadding.NONE,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    val paddingModifier = padding.value?.let { Modifier.padding(it) } ?: Modifier
    Box(modifier = modifier.then(paddingModifier)) { content() }
}

/** Surface variants mirroring the web `TranSurface`: `DEFAULT` is the translucent card, `RAISED`
 * the opaque panel, `FIELD` the input background. */
enum class TranSurfaceVariant { DEFAULT, RAISED, FIELD }

enum class TranSurfaceRadius(val value: Dp) {
    SM(TranRadius.sm),
    MD(TranRadius.md),
    LG(TranRadius.lg),
}

@Composable
fun TranSurface(
    modifier: Modifier = Modifier,
    surface: TranSurfaceVariant = TranSurfaceVariant.DEFAULT,
    radius: TranSurfaceRadius = TranSurfaceRadius.MD,
    padding: TranBoxPadding = TranBoxPadding.MD,
    content: @Composable ColumnScope.() -> Unit,
) {
    val palette = LocalTranPalette.current
    val background: Color = when (surface) {
        TranSurfaceVariant.DEFAULT -> palette.surface.copy(alpha = 0.4f)
        TranSurfaceVariant.RAISED, TranSurfaceVariant.FIELD -> palette.surface
    }
    val paddingModifier = padding.value?.let { Modifier.padding(it) } ?: Modifier
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(radius.value))
            .background(background)
            .then(paddingModifier),
        content = content,
    )
}

/** Separator line bound to the palette instead of the Material divider default. */
@Composable
fun TranDivider(modifier: Modifier = Modifier) {
    val palette = LocalTranPalette.current
    HorizontalDivider(modifier = modifier, color = palette.textPrimary.copy(alpha = 0.2f))
}

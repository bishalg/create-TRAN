package com.tran.voting.architecture

import com.lemonappdev.konsist.api.Konsist
import com.lemonappdev.konsist.api.ext.list.withPackage
import com.lemonappdev.konsist.api.verify.assertTrue
import org.junit.jupiter.api.Test

/**
 * Architectural guardrail tests using Konsist.
 * Inspired by Element X Android (`konsistTest/`).
 */
class KonsistArchitectureTest {

    @Test
    fun `feature modules must never import internal classes from other feature modules`() {
        Konsist
            .scopeFromProject()
            .files
            .withPackage("com.tran.voting.feature..")
            .assertTrue { file ->
                val currentPackage = file.packageDirective?.name ?: ""
                val illegalInternalImports = file.imports.filter { import ->
                    import.name.contains(".internal.") && !import.name.startsWith(currentPackage)
                }
                illegalInternalImports.isEmpty()
            }
    }

    @Test
    fun `all Repository implementations reside in data package`() {
        Konsist
            .scopeFromProject()
            .classes()
            .withNameEndingWith("RepositoryImpl")
            .assertTrue { clazz ->
                clazz.resideInPackage("..data..")
            }
    }

    @Test
    fun `no Android classes or UI dependencies inside domain layer`() {
        Konsist
            .scopeFromProject()
            .files
            .withPackage("..domain..")
            .assertTrue { file ->
                val hasAndroidImports = file.imports.any { import ->
                    import.name.startsWith("android.") ||
                    import.name.startsWith("androidx.")
                }
                !hasAndroidImports
            }
    }
}

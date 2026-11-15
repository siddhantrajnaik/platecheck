# Reference values: NormqPCR (Bioconductor) geNorm and NormFinder on the datasets shipped with it.
lib <- file.path(Sys.getenv("LOCALAPPDATA"), "Temp", "Rlib"); .libPaths(c(lib, .libPaths()))
suppressMessages(library(NormqPCR)); options(digits = 15)
data(geNorm.qPCRBatch); x <- t(exprs(geNorm.qPCRBatch))   # relative quantities (linear), samples x genes
tissue <- as.factor(c(rep("BM", 9), rep("FIB", 20), rep("LEU", 13), rep("NB", 34), rep("POOL", 9)))
write.csv(data.frame(sample = rownames(x), tissue = tissue, x, check.names = FALSE), "genorm_data.csv", row.names = FALSE)
out <- list()
for (tt in levels(tissue)) { r <- selectHKs(x[tissue == tt, ], method = "geNorm", Symbols = colnames(x), minNrHKs = 2, log = FALSE, trace = FALSE)
  out[[tt]] <- list(ranking = unname(r$ranking), V = as.list(r$variation), meanM = as.list(r$meanM),
    M = as.list(stabMeasureM(x[tissue == tt, ], log = FALSE))) }
data(Bladder); b <- t(exprs(Bladder)); grade <- pData(Bladder)$Grade
cat("Bladder value range:", range(b, na.rm = TRUE), " groups:", levels(factor(grade)), " n:", nrow(b), " genes:", ncol(b), "\n")
write.csv(data.frame(sample = rownames(b), grade = grade, b, check.names = FALSE), "bladder_data.csv", row.names = FALSE)
nf <- selectHKs(b, group = factor(grade), method = "NormFinder", Symbols = colnames(b), minNrHKs = 2, log = FALSE, trace = FALSE)
rho <- stabMeasureRho(b, group = factor(grade), log = FALSE)
rho1 <- suppressWarnings(stabMeasureRho(b, group = factor(rep(1, nrow(b))), log = FALSE))
out$bladder <- list(rho = as.list(rho), ranking = unname(nf$ranking), rhoPair = unname(nf$rho), noGroupVar = as.list(rho1))
writeLines(jsonlite::toJSON(out, auto_unbox = TRUE, digits = 15), "ref.json")
print(out$BM$ranking); print(unlist(out$BM$V)); print(round(unlist(rho), 6)); print(nf)

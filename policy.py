from __future__ import annotations

from app.models import RiskAssessment, RiskLevel, Stage, TaskCreateRequest


HIGH_RISK_KEYWORDS = {
    "rm -rf",
    "drop table",
    "truncate",
    "force push",
    "production",
    "root access",
    "terraform destroy",
}


def _risk_level(score: int) -> RiskLevel:
    if score >= 80:
        return RiskLevel.CRITICAL
    if score >= 60:
        return RiskLevel.HIGH
    if score >= 35:
        return RiskLevel.MEDIUM
    return RiskLevel.LOW


def assess_risk(req: TaskCreateRequest) -> RiskAssessment:
    score = 0
    reasons: list[str] = []

    stage_weights = {
        Stage.DESIGN: 10,
        Stage.DEVELOPMENT: 20,
        Stage.DEPLOYMENT: 45,
        Stage.INCIDENT_RESPONSE: 35,
        Stage.COMMUNICATION: 5,
        Stage.GOVERNANCE: 15,
    }
    score += stage_weights[req.stage]
    reasons.append(f"Stage '{req.stage.value}' contributes {stage_weights[req.stage]} points.")

    if req.impacts_production:
        score += 25
        reasons.append("Task impacts production systems (+25).")
    if req.touches_security_controls:
        score += 20
        reasons.append("Task touches security controls (+20).")
    if req.touches_data_layer:
        score += 15
        reasons.append("Task touches data layer (+15).")

    if req.estimated_files_changed > 200:
        score += 12
        reasons.append("Large change set (>200 files) (+12).")
    elif req.estimated_files_changed > 50:
        score += 7
        reasons.append("Medium-large change set (>50 files) (+7).")

    if req.confidence < 0.5:
        delta = int((0.5 - req.confidence) * 40)
        if delta > 0:
            score += delta
            reasons.append(f"Low model confidence (+{delta}).")

    actions_text = " ".join(req.proposed_actions).lower()
    for keyword in HIGH_RISK_KEYWORDS:
        if keyword in actions_text:
            score += 12
            reasons.append(f"High-risk action keyword detected: '{keyword}' (+12).")

    model_risk_score = 0
    if req.confidence < 0.65:
        delta = int((0.65 - req.confidence) * 60)
        model_risk_score += max(delta, 0)
        if delta > 0:
            reasons.append(f"Model confidence risk (+{delta}).")
    if req.drift_signal > 0.35:
        delta = int((req.drift_signal - 0.35) * 50)
        model_risk_score += max(delta, 0)
        if delta > 0:
            reasons.append(f"Model drift signal elevated (+{delta}).")
    if req.historical_failure_rate > 0.05:
        delta = int((req.historical_failure_rate - 0.05) * 80)
        model_risk_score += max(delta, 0)
        if delta > 0:
            reasons.append(f"Historical model failure rate elevated (+{delta}).")
    if req.autonomy_level >= 4:
        model_risk_score += 15
        reasons.append("High autonomy delegation level (+15).")
    if req.safety_override_requested:
        model_risk_score += 25
        reasons.append("Safety override requested (+25).")

    model_risk_score = min(model_risk_score, 100)
    model_risk_level = _risk_level(model_risk_score)
    score = min(score + int(model_risk_score * 0.35), 100)
    level = _risk_level(score)

    min_required_approvals = 1
    requires_security_approval = False
    requires_dry_run = False
    requires_model_risk_approval = False

    if level in {RiskLevel.HIGH, RiskLevel.CRITICAL}:
        min_required_approvals = 2
        requires_dry_run = True
    if req.touches_security_controls or level is RiskLevel.CRITICAL:
        requires_security_approval = True
    if model_risk_level in {RiskLevel.HIGH, RiskLevel.CRITICAL}:
        requires_model_risk_approval = True
        min_required_approvals = max(min_required_approvals, 2)
        requires_dry_run = True
    if req.autonomy_level == 5:
        requires_model_risk_approval = True

    return RiskAssessment(
        score=score,
        level=level,
        rationale=reasons,
        min_required_approvals=min_required_approvals,
        requires_security_approval=requires_security_approval,
        requires_dry_run=requires_dry_run,
        model_risk_score=model_risk_score,
        model_risk_level=model_risk_level,
        requires_model_risk_approval=requires_model_risk_approval,
    )

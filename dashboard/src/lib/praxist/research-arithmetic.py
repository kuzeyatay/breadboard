"""Reproduce bounded numerical expressions; do not evaluate scientific truth."""
import argparse
import ast
import json
import math
import operator
from pathlib import Path

OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
       ast.Div: operator.truediv, ast.Pow: operator.pow}


def calculate(expression):
    if not isinstance(expression, str) or len(expression) > 500:
        raise ValueError("Expression must be a bounded arithmetic string")
    tree = ast.parse(expression, mode="eval")
    if len(list(ast.walk(tree))) > 100:
        raise ValueError("Too many arithmetic nodes")

    def visit(node):
        if isinstance(node, ast.Expression):
            return visit(node.body)
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            value = float(node.value)
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            value = visit(node.operand) * (-1 if isinstance(node.op, ast.USub) else 1)
        elif isinstance(node, ast.BinOp) and type(node.op) in OPS:
            left, right = visit(node.left), visit(node.right)
            if isinstance(node.op, ast.Pow) and abs(right) > 10:
                raise ValueError("Exponent is out of bounds")
            value = OPS[type(node.op)](left, right)
        else:
            raise ValueError("Only numeric arithmetic is permitted")
        if not isinstance(value, (int, float)) or not math.isfinite(value) or abs(value) > 1e15:
            raise ValueError("Result is out of bounds")
        return value

    return visit(tree)


def evaluate(candidate):
    checks = candidate.get("checks", [])
    if not isinstance(checks, list) or not 1 <= len(checks) <= 30:
        raise ValueError("Provide 1 to 30 distinct relevant checks")
    receipts, seen = [], set()
    for check in checks:
        label = str(check.get("label", "")).strip()
        try:
            if not label or label in seen or not check.get("basis") or not check.get("unit"):
                raise ValueError("Missing or duplicate label, basis or unit")
            seen.add(label)
            actual = calculate(check.get("expression"))
            reported = float(check["reported"])
            passed = math.isfinite(reported) and math.isclose(actual, reported, rel_tol=0.001, abs_tol=0.001)
            receipts.append({**check, "calculated": actual, "passed": passed})
        except (ValueError, TypeError, KeyError, ZeroDivisionError, OverflowError, SyntaxError) as error:
            receipts.append({"label": label, "passed": False, "error": str(error)})
    # Completion measures execution of the declared arithmetic audit, not whether
    # every submitted claim passed or whether the scientific question is settled.
    completed = len(receipts)
    required = len(checks)
    return {"metrics": {"verified_checks": sum(r["passed"] for r in receipts)},
            "evidence_stage": "complete", "scored_complete": completed == required,
            "actual_effort_units": completed, "required_effort_units": required,
            "completed_required_eval_units": completed, "total_required_eval_units": required,
            "coverage_scope": "The submitted arithmetic checks only; not all scientific claims or research deliverables.",
            "checks": receipts,
            "limitation": "Arithmetic only. Relevance, source fidelity and scientific validity require independent review."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = evaluate(json.loads(Path(args.candidate).read_text(encoding="utf-8")))
    Path(args.output).write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result))
